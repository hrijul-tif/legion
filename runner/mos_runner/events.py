"""JSON-line event stream (fd 1 of the process as seen by the server) + print() capture."""
import datetime as _dt
import enum
import json
import math
import os
import re
import sys
import threading
import time

_ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
_lock = threading.Lock()
_out = None
_t0 = time.monotonic()


def strip_ansi(s):
    return _ANSI.sub("", s) if isinstance(s, str) else s


def init_stream():
    """Reserve the real stdout for the event protocol; anything else that writes to fd 1 goes to stderr."""
    global _out, _t0
    _out = os.fdopen(os.dup(1), "w", encoding="utf-8", buffering=1)
    os.dup2(2, 1)
    _t0 = time.monotonic()


def elapsed():
    return time.monotonic() - _t0


def jsonable(v, depth=0):
    """Best-effort conversion of YAMCS values to something JSON.parse can read."""
    if v is None or isinstance(v, (bool, int, str)):
        return v
    if isinstance(v, float):
        return v if math.isfinite(v) else None
    if depth > 6:
        return str(v)
    if isinstance(v, (_dt.datetime, _dt.date)):
        return v.isoformat()
    if isinstance(v, enum.Enum):
        return jsonable(v.value, depth + 1)
    if isinstance(v, (bytes, bytearray)):
        return v.hex()
    if isinstance(v, dict):
        return {str(k): jsonable(x, depth + 1) for k, x in v.items()}
    if isinstance(v, (list, tuple, set)):
        return [jsonable(x, depth + 1) for x in v]
    return str(v)


def emit(ev):
    ev.setdefault("t", round(elapsed(), 3))
    ev.setdefault("wall", int(time.time() * 1000))
    line = json.dumps(ev, default=str, allow_nan=False, separators=(",", ":"))
    with _lock:
        if _out is not None:
            _out.write(line + "\n")
            _out.flush()


def log(level, msg, logger="run"):
    emit({"type": "log", "level": level, "msg": strip_ansi(str(msg)), "logger": logger})


class Capture:
    """File-like object turning print() output into `stdout` events, one per line."""

    def __init__(self, stream):
        self.stream = stream
        self.buf = ""
        self.encoding = "utf-8"

    def write(self, s):
        if not isinstance(s, str):
            s = str(s)
        self.buf += s
        while "\n" in self.buf:
            line, self.buf = self.buf.split("\n", 1)
            self._send(line)
        return len(s)

    def _send(self, line):
        ev = {"type": "stdout", "text": strip_ansi(line)}
        if self.stream != "stdout":
            ev["stream"] = self.stream
        emit(ev)

    def flush(self):
        pass

    def isatty(self):
        return False

    def finish(self):
        if self.buf:
            self._send(self.buf)
            self.buf = ""
