"""Executes one procedure run inside Pyodide (called by workers/run.worker.ts and the node tests)."""
import ast
import importlib.util
import inspect
import json
import linecache
import os
import sys
import traceback

from . import bridge, processor
from .convert import convert
from .procedure_info import pick_entrypoint
from .world import World

RUN_DIR = '/home/pyodide/mos_runs'
MODULE_NAME = 'procedure'
SIM_DIR = '/sim'


class _Capture(object):
    """File-like object turning print() output into `stdout` events (one per line)."""

    def __init__(self, world, stream):
        self.world = world
        self.stream = stream
        self.buf = ''
        self.encoding = 'utf-8'

    def write(self, s):
        if not isinstance(s, str):
            s = str(s)
        self.buf += s
        while '\n' in self.buf:
            line, self.buf = self.buf.split('\n', 1)
            self._send(line)
        return len(s)

    def _send(self, line):
        ev = {'type': 'stdout', 'text': line}
        if self.stream != 'stdout':
            ev['stream'] = self.stream
        self.world.emit(ev)

    def flush(self):
        pass

    def isatty(self):
        return False

    def finish(self):
        if self.buf:
            self._send(self.buf)
            self.buf = ''


def _load_sim(mission, opts):
    inline = opts.get('sim')
    if isinstance(inline, dict):
        return inline, 'inline'
    path = '%s/%s-sim.json' % (SIM_DIR, mission.lower())
    if not os.path.exists(path):
        return {}, None
    with open(path, 'r') as fh:
        return json.load(fh), path


def _trace(exc, path):
    frames = [f for f in traceback.extract_tb(exc.__traceback__) if f.filename == path]
    lines = ['Traceback (most recent call last):\n'] + traceback.format_list(frames) + traceback.format_exception_only(type(exc), exc)
    return ''.join(lines).replace(path, 'procedure.py')


def _ensure_framework_connections():
    # (re)bind the processor in super_class in case a previous run replaced it
    from framework.mdb import super_class
    super_class.set_connections()


def run(req_json):
    from framework import _catalog
    from framework.settings import settings
    from framework.utils.custom_exceptions import SkipProcedureError, ChooseProcedureError, StopExecutionError

    req = json.loads(req_json)
    mission = req.get('mission') or 'FF'
    opts = req.get('options') or {}
    started = bridge.real_time()
    outcome, error, trace, retval = 'error', None, None, None
    world = None
    out = err = None
    saved_streams = (sys.stdout, sys.stderr)
    code_path = os.path.join(RUN_DIR, MODULE_NAME + '.py')

    try:
        cat = _catalog.get(mission)
        sim, sim_src = _load_sim(mission, opts)
        warp = opts.get('warp', 1)
        world = World(mission, cat, sim, warp=warp, faults=opts.get('faults') or [], seed=opts.get('seed', 1))
        processor.set_world(world)
        _ensure_framework_connections()
        settings.MISSION = mission
        settings.INSTANCE = '%s1-sandbox' % mission.lower()
        if cat is None:
            world.log('warning', 'No %s catalog loaded: generated commands/parameters are unavailable' % mission)
        if sim_src is None:
            world.log('warning', 'No sim file for %s: using default telemetry and command behaviour' % mission)
        for q, v in (opts.get('telemetry') or {}).items():
            world.store.set(world._q(q), v, force=True)

        out, err = _Capture(world, 'stdout'), _Capture(world, 'stderr')
        sys.stdout, sys.stderr = out, err
        world.clock.patch()
        world.emit_telemetry(force=True)

        code = req['code']
        try:
            tree = ast.parse(code)
        except SyntaxError as exc:
            raise ProcedureSetupError('SyntaxError: %s (line %s)' % (exc.msg, exc.lineno))
        fn_node, _names, ep_err = pick_entrypoint(tree, req.get('entrypoint'))
        if fn_node is None:
            raise ProcedureSetupError(ep_err)

        os.makedirs(RUN_DIR, exist_ok=True)
        with open(code_path, 'w') as fh:
            fh.write(code)
        linecache.checkcache(code_path)
        sys.modules.pop(MODULE_NAME, None)
        spec = importlib.util.spec_from_file_location(MODULE_NAME, code_path)
        module = importlib.util.module_from_spec(spec)
        sys.modules[MODULE_NAME] = module
        spec.loader.exec_module(module)
        fn = getattr(module, fn_node.name)

        kwargs = _convert_args(fn, req.get('args') or {})
        retval = fn(**kwargs)
        outcome = 'completed'
    except ProcedureSetupError as exc:
        outcome, error = 'error', str(exc)
    except SkipProcedureError:
        outcome, error = 'skipped', 'Procedure skipped by the operator'
    except StopExecutionError:
        outcome, error = 'stopped', 'Execution stopped (StopExecutionError)'
    except ChooseProcedureError:
        outcome, error = 'choose', 'Operator asked to choose another procedure'
    except KeyboardInterrupt:
        outcome, error = 'stopped', 'Stopped by the operator'
    except SystemExit as exc:
        outcome, error = 'stopped', 'Procedure called sys.exit(%r)' % (exc.code,)
    except BaseException as exc:
        outcome = 'error'
        error = '%s: %s' % (type(exc).__name__, exc)
        trace = _trace(exc, code_path)
    finally:
        try:
            if world is not None:
                world.clock.unpatch()
            for c in (out, err):
                if c is not None:
                    c.finish()
            sys.stdout, sys.stderr = saved_streams
            sys.modules.pop(MODULE_NAME, None)
            if world is not None:
                world.finish()
        finally:
            sys.stdout, sys.stderr = saved_streams
            processor.set_world(None)

    return json.dumps({
        'outcome': outcome,
        'error': error,
        'traceback': trace,
        'returnValue': None if retval is None else repr(retval),
        'virtualSeconds': round(world.clock.now, 3) if world is not None else 0,
        'wallMs': int((bridge.real_time() - started) * 1000),
    }, default=str)


class ProcedureSetupError(Exception):
    pass


def _convert_args(fn, args):
    sig = inspect.signature(fn)
    params = sig.parameters
    kwargs = {}
    for name in args:
        if name not in params:
            raise ProcedureSetupError('Unexpected argument %r (the entrypoint accepts: %s)' % (name, ', '.join(params) or 'none'))
    for name, p in params.items():
        if p.kind in (p.VAR_POSITIONAL, p.VAR_KEYWORD):
            continue
        if name not in args:
            if p.default is p.empty:
                raise ProcedureSetupError('Missing required argument %r' % name)
            continue
        try:
            kwargs[name] = convert(args[name], p.annotation, name)
        except Exception as exc:
            raise ProcedureSetupError('Invalid value for argument %r: %s: %s' % (name, type(exc).__name__, exc))
    return kwargs
