import argparse
import ast
import importlib.util
import inspect
import json
import os
import shutil
import signal
import sys
import tempfile
import time
import traceback

from . import events
from .convert import convert
from .entry import pick_entrypoint
from .events import emit


class SetupError(Exception):
    pass


def _trace(exc, path):
    frames = [f for f in traceback.extract_tb(exc.__traceback__) if f.filename == path]
    if not frames:
        frames = traceback.extract_tb(exc.__traceback__)[-6:]
    lines = ["Traceback (most recent call last):\n"] + traceback.format_list(frames) + traceback.format_exception_only(type(exc), exc)
    return "".join(lines).replace(path, "procedure.py")


def _convert_args(fn, args):
    params = inspect.signature(fn).parameters
    for name in args:
        if name not in params:
            raise SetupError("Unexpected argument %r (the entrypoint accepts: %s)" % (name, ", ".join(params) or "none"))
    kwargs = {}
    for name, p in params.items():
        if p.kind in (p.VAR_POSITIONAL, p.VAR_KEYWORD):
            continue
        if name not in args:
            if p.default is p.empty:
                raise SetupError("Missing required argument %r" % name)
            continue
        try:
            kwargs[name] = convert(args[name], p.annotation, name)
        except Exception as exc:
            raise SetupError("Invalid value for argument %r: %s: %s" % (name, type(exc).__name__, exc))
    return kwargs


def _on_term(signum, frame):
    raise KeyboardInterrupt


def execute(ns, code, tmp):
    from . import guard, instrument

    try:
        tree = ast.parse(code)
    except SyntaxError as exc:
        raise SetupError("SyntaxError: %s (line %s)" % (exc.msg, exc.lineno))
    bad = guard.check(tree)
    if bad:
        raise SetupError(bad)
    fn_node, _names, ep_err = pick_entrypoint(tree, ns.entry)
    if fn_node is None:
        raise SetupError(ep_err)

    os.environ.update(
        ENVIRONMENT="bifrost",
        MISSION=ns.mission,
        INSTANCE=ns.instance,
        YAMCS_URL=ns.yamcs_url,
        YAMCS_USERNAME="",
        YAMCS_PASSWORD="",
        # Settings declares these as `str = None` with validate_default, so they must exist (the real deployments set them in .env)
        WDS_ENDPOINT="",
        WDS_PORT="",
        SLACK_BOT_TOKEN="",
    )
    try:
        sc = instrument.install()
    except ImportError as exc:
        raise SetupError("The mos-framework is not installed in the runner (%s). Run `npm run bifrost:setup`." % exc)

    code_path = os.path.join(tmp, "procedure.py")
    with open(code_path, "w") as fh:
        fh.write(code)
    ns.code_path = code_path

    events.log("info", "Connecting to YAMCS at http://%s (instance %s)" % (ns.yamcs_url, ns.instance), "sim")
    try:
        sc.set_connections()
    except Exception as exc:
        raise SetupError("Could not connect to YAMCS at http://%s: %s: %s (is the VPN up and the simulation RUNNING?)" % (ns.yamcs_url, type(exc).__name__, exc))
    instrument.wrap_connections(sc)

    spec = importlib.util.spec_from_file_location("procedure", code_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules["procedure"] = module
    spec.loader.exec_module(module)
    fn = getattr(module, fn_node.name)
    return fn(**_convert_args(fn, json.loads(ns.args_json or "{}")))


def main():
    ap = argparse.ArgumentParser(prog="mos_runner")
    ap.add_argument("--code-file", required=True)
    ap.add_argument("--entry", default=None)
    ap.add_argument("--args-json", default="{}")
    ap.add_argument("--yamcs-url", required=True, help="YAMCS address without scheme, e.g. bifrost.pixxel.space/yamcs/<session>")
    ap.add_argument("--instance", default="jtyu")
    ap.add_argument("--mission", default="jtyu")
    ns = ap.parse_args()
    ns.code_path = None
    ns.code_file = os.path.abspath(ns.code_file)  # resolved before we chdir into the temp dir

    events.init_stream()
    out, err = events.Capture("stdout"), events.Capture("stderr")
    sys.stdout, sys.stderr = out, err
    signal.signal(signal.SIGINT, signal.default_int_handler)
    signal.signal(signal.SIGTERM, _on_term)

    tmp = tempfile.mkdtemp(prefix="mos-run-")
    os.chdir(tmp)  # the framework's log_helper creates ./pass_logs* at import time
    outcome, error, trace, retval = "error", None, None, None
    try:
        with open(ns.code_file, "r") as fh:
            code = fh.read()
        from framework.utils.custom_exceptions import ChooseProcedureError, SkipProcedureError, StopExecutionError  # noqa: F401
    except ImportError:
        code = None
        SkipProcedureError = ChooseProcedureError = StopExecutionError = ()  # type: ignore
    except OSError as exc:
        code = None
        error = "Cannot read the procedure file: %s" % exc
    try:
        if code is None:
            if error is None:
                error = "The mos-framework is not installed in the runner. Run `npm run bifrost:setup`."
        else:
            retval = execute(ns, code, tmp)
            outcome = "completed"
    except SetupError as exc:
        outcome, error = "error", str(exc)
    except SkipProcedureError:
        outcome, error = "skipped", "Procedure skipped by the operator"
    except StopExecutionError:
        outcome, error = "stopped", "Execution stopped (StopExecutionError)"
    except ChooseProcedureError:
        outcome, error = "choose", "Operator asked to choose another procedure"
    except KeyboardInterrupt:
        signal.signal(signal.SIGINT, signal.SIG_IGN)
        outcome, error = "stopped", "Stopped by the operator"
    except SystemExit as exc:
        outcome, error = "stopped", "Procedure called sys.exit(%r)" % (exc.code,)
    except BaseException as exc:  # the procedure's own errors
        outcome = "error"
        error = "%s: %s" % (type(exc).__name__, exc)
        trace = _trace(exc, ns.code_path or "procedure.py")
    finally:
        signal.signal(signal.SIGINT, signal.SIG_IGN)
        out.finish()
        err.finish()
        sys.stdout, sys.stderr = sys.__stdout__, sys.__stderr__

    wall = events.elapsed()
    emit({
        "type": "done",
        "outcome": outcome,
        "error": error,
        "traceback": trace,
        "returnValue": None if retval is None else repr(retval),
        "virtualSeconds": round(wall, 3),
        "wallMs": int(wall * 1000),
    })
    shutil.rmtree(tmp, ignore_errors=True)
    # the yamcs client leaves websocket threads running; do not wait for them
    os._exit(0)
