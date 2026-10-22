"""Hooks that make the real mos-framework talk to the IDE: prompts, command/TM events and log forwarding.

Everything is applied to the already-imported framework (nothing in the framework source is edited):
  * YamcsConnectionHandler.create_yamcs_client: no credentials when the username is empty (Bifrost's YAMCS is open)
  * inquirer.prompt: becomes a `prompt` event + a blocking read of one JSON line on stdin
  * super_class.realtime_processor / conn: wrapped so every command and TM read becomes an event
  * run_logger / extra_logger: forwarded as `log` events (their stdout StreamHandler is removed)
"""
import functools
import inspect
import json
import logging
import sys
import threading
import uuid

from . import events
from .events import emit, jsonable, strip_ansi

_local = threading.local()


def _stack():
    st = getattr(_local, "stack", None)
    if st is None:
        st = _local.stack = []
    return st


def _current(kind):
    for obj in reversed(_stack()):
        if type(obj).__mro__ and any(c.__name__ == kind for c in type(obj).__mro__):
            return obj
    return None


def _track(cls):
    for name, fn in list(vars(cls).items()):
        if not inspect.isfunction(fn) or (name.startswith("__") and name.endswith("__")):
            continue

        def make(f):
            @functools.wraps(f)
            def wrapper(self, *a, **k):
                st = _stack()
                st.append(self)
                try:
                    return f(self, *a, **k)
                finally:
                    st.pop()

            return wrapper

        setattr(cls, name, make(fn))


class MonitoredProxy:
    """Wraps yamcs MonitoredCommand: await_complete reports the final command status."""

    def __init__(self, real, q, cls, args):
        self._real, self._q, self._cls, self._args = real, q, cls, args

    def __getattr__(self, name):
        return getattr(self._real, name)

    def _event(self, status, error=None):
        ev = {"type": "command", "q": self._q, "cls": self._cls, "args": self._args, "status": status}
        if error:
            ev["error"] = strip_ansi(str(error))
        emit(ev)

    def await_complete(self, timeout=None):
        try:
            self._real.await_complete(timeout)
        except TimeoutError:
            self._event("timeout", "no CommandComplete acknowledgment within %ss" % timeout)
            raise
        if self._real.is_success():
            self._event("completed")
        else:
            self._event("failed", self._real.error or "command failed")


class ConnProxy:
    def __init__(self, real):
        self._real = real

    def __getattr__(self, name):
        return getattr(self._real, name)

    def issue(self, command, args=None, *a, **k):
        mc = self._real.issue(command, args, *a, **k)
        return _issued(mc, command, args)


def _issued(mc, command, args):
    cmd = _current("SuperCommand")
    cls = type(cmd).__name__ if cmd is not None and getattr(cmd, "qualified_name", None) == command else command.rsplit("/", 1)[-1]
    clean = jsonable(dict(args or {}))
    emit({"type": "command", "q": command, "cls": cls, "args": clean, "status": "issued"})
    return MonitoredProxy(mc, command, cls, clean)


class ProcessorProxy:
    def __init__(self, real):
        self._real = real

    def __getattr__(self, name):
        return getattr(self._real, name)

    def get_parameter_value(self, parameter, from_cache=True, timeout=10):
        pv = self._real.get_parameter_value(parameter, from_cache=from_cache, timeout=timeout)
        if pv is not None:
            p = _current("SuperParameter")
            cls = type(p).__name__ if p is not None and getattr(p, "qualified_name", None) == parameter else None
            emit({"type": "tm", "q": parameter, "cls": cls, "value": jsonable(pv.eng_value), "fresh": not from_cache})
        return pv

    def issue_command(self, command, args=None, *a, **k):
        return _issued(self._real.issue_command(command, args, *a, **k), command, args)

    def create_command_connection(self, *a, **k):
        return ConnProxy(self._real.create_command_connection(*a, **k))


class _Handler(logging.Handler):
    def __init__(self, tag, level=logging.DEBUG):
        super().__init__(level)
        self.tag = tag

    def emit(self, record):
        try:
            n = record.levelno
            level = "error" if n >= logging.ERROR else "warning" if n >= logging.WARNING else "info" if n >= logging.INFO else "debug"
            events.log(level, record.getMessage(), self.tag)
        except Exception:
            pass


def _forward(lg, tag):
    for h in list(lg.handlers):
        if isinstance(h, logging.StreamHandler) and not isinstance(h, logging.FileHandler):
            lg.removeHandler(h)
    lg.addHandler(_Handler(tag))


def _prompt(questions, *a, **k):
    answers = {}
    for q in questions if isinstance(questions, (list, tuple)) else [questions]:
        raw = list(getattr(q, "choices", []) or [])
        choices = [strip_ansi(str(c[0] if isinstance(c, (tuple, list)) else c)) for c in raw]
        values = [c[1] if isinstance(c, (tuple, list)) else c for c in raw]
        pid = uuid.uuid4().hex[:12]
        emit({"type": "prompt", "id": pid, "message": strip_ansi(str(getattr(q, "message", "") or "")), "choices": choices})
        while True:
            line = sys.__stdin__.readline()
            if not line:
                raise KeyboardInterrupt  # the server went away or closed stdin: treat as stop
            try:
                msg = json.loads(line)
            except ValueError:
                continue
            if msg.get("id") != pid:
                continue
            c = msg.get("choice")
            if isinstance(c, int) and 0 <= c < len(choices):
                idx = c
            elif c in choices:
                idx = choices.index(c)
            else:
                continue
            answers[q.name] = values[idx]
            break
    return answers


def install():
    """Call after `framework` is importable and its env is set."""
    import inquirer
    from framework.mdb import super_class as sc
    from framework.mdb.connection_handler import YamcsConnectionHandler
    from framework.utils import log_helper

    # yamcs-client 1.10 would POST /auth/token with empty credentials; Bifrost's YAMCS has no auth
    from yamcs.client import YamcsClient
    from yamcs.core.auth import Credentials

    def create_yamcs_client(url, username, password):
        print("Connecting to MCS at: %s" % url)
        creds = Credentials(username=username, password=password) if username else None
        return YamcsClient(address=url, credentials=creds)

    YamcsConnectionHandler.create_yamcs_client = staticmethod(create_yamcs_client)
    inquirer.prompt = _prompt

    _track(sc.SuperCommand)
    _track(sc.SuperParameter)
    _forward(log_helper.run_logger, "run")
    _forward(log_helper.extra_logger, "extra")
    root = logging.getLogger()
    root.addHandler(_Handler("run", logging.WARNING))
    return sc


def wrap_connections(sc):
    sc.realtime_processor = ProcessorProxy(sc.realtime_processor)
    sc.logging_processor = ProcessorProxy(sc.logging_processor)
    sc.conn = ConnProxy(sc.conn)
