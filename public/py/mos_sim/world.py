"""The mock spacecraft for one run: clock + telemetry store + command effects + faults."""
import fnmatch
import json
import math
import random

from . import bridge
from .clock import Clock
from .telemetry import Store

TELEMETRY_EMIT_INTERVAL = 0.25   # real seconds => at most 4 telemetry events / s
DEFAULT_LATENCY = (0.4, 1.2)
DEFAULT_AWAIT_TIMEOUT = 30.0     # virtual seconds an await_complete(None) waits on a hung command

_EVAL_GLOBALS = {'__builtins__': {}, 'math': math, 'min': min, 'max': max, 'abs': abs, 'round': round,
                 'int': int, 'float': float, 'str': str, 'len': len, 'sum': sum, 'bool': bool}


def parse_warp(v):
    if v is None:
        return math.inf
    if isinstance(v, str):
        try:
            v = float(v)
        except ValueError:
            return math.inf
    v = float(v)
    return math.inf if (v <= 0 or math.isinf(v) or math.isnan(v)) else v


def _num_eq(a, b):
    try:
        return float(a) == float(b)
    except (TypeError, ValueError):
        return False


def values_match(actual, expected):
    if isinstance(expected, list):
        return any(values_match(actual, x) for x in expected)
    if actual == expected or str(actual) == str(expected):
        return True
    if isinstance(expected, bool) or isinstance(actual, bool):
        return False
    return _num_eq(actual, expected)


def _fault_key(f):
    return json.dumps(f, sort_keys=True, default=str)


class World(object):
    def __init__(self, mission, catalog, sim=None, warp=1.0, faults=None, seed=1):
        self.mission = mission
        self.catalog = catalog
        self.sim = sim or {}
        self.clock = Clock(self, parse_warp(warp))
        self.rng = random.Random(seed)
        self.dirty = True
        self.last_tm_emit = 0.0
        self.last_tm_virtual = -1.0
        self.faults = []
        self.consumed = set()
        self._frozen = set()
        self._dropped = set()
        self.cmd_seq = 0
        self.records = []

        lat = self.sim.get('latency') or list(DEFAULT_LATENCY)
        self.latency = (float(lat[0]), float(lat[-1]))
        self.effects = [e for e in (self.sim.get('effects') or []) if isinstance(e, dict)]
        self.counter_q = self.sim.get('commandCounter') or '/MOS/CommandCounter'
        default_cadence = self.sim.get('defaultCadence', 1.0)
        initial = {self._q(k): v for k, v in (self.sim.get('initial') or {}).items()}
        cadence = {self._q(k): v for k, v in (self.sim.get('cadence') or {}).items()}
        rates = {self._q(k): v for k, v in (self.sim.get('rates') or {}).items()}
        self.store = Store(self, catalog, initial, cadence, rates, default_cadence)
        self._validate_sim(initial, cadence, rates)
        for q in initial:
            self.store.get(q)
        self.store.get(self.counter_q)
        self.set_faults(faults or [])

    # ---- helpers ----------------------------------------------------------------------------
    def _q(self, name):
        return self.catalog.resolve_param_q(name) if self.catalog else name

    def log(self, level, msg):
        self.emit({'type': 'log', 'level': level, 'msg': msg, 'logger': 'sim'})

    def _validate_sim(self, initial, cadence, rates):
        if not self.catalog:
            return
        for label, d in (('initial', initial), ('cadence', cadence), ('rates', rates)):
            for q in d:
                if self.catalog.param_info(q) is None and q != self.counter_q:
                    self.log('warning', 'sim file: "%s" refers to unknown parameter %s' % (label, q))
        for i, e in enumerate(self.effects):
            c = e.get('command')
            if c and '*' not in c and self.catalog.command_info(c) is None and c not in self.catalog.cmd_defs:
                self.log('warning', 'sim file: effects[%d] refers to unknown command %s' % (i, c))
            for pq in list((e.get('set') or {}).keys()) + list(e.get('sample') or []):
                if self.catalog.param_info(self._q(pq)) is None:
                    self.log('warning', 'sim file: effects[%d] refers to unknown parameter %s' % (i, pq))

    # ---- events -------------------------------------------------------------------------------
    def emit(self, ev):
        ev['t'] = round(self.clock.now, 3)
        ev['wall'] = int(bridge.real_time() * 1000)
        bridge.send(ev)

    def emit_telemetry(self, force=False):
        now_real = bridge.real_time()
        if not force:
            if now_real - self.last_tm_emit < TELEMETRY_EMIT_INTERVAL:
                return
            if not self.dirty and not (self.store.has_rates and self.clock.now != self.last_tm_virtual):
                return
        self.last_tm_emit = now_real
        self.last_tm_virtual = self.clock.now
        self.dirty = False
        self.emit({'type': 'telemetry', 'values': self.store.snapshot()})

    # ---- control plane ---------------------------------------------------------------------
    def pump(self):
        bridge.check_interrupt()
        for m in bridge.read_mailbox():
            self.apply_control(m)
        self.emit_telemetry()

    def after_advance(self):
        self.emit_telemetry()

    def apply_control(self, m):
        if not isinstance(m, dict):
            return
        kind = m.get('kind')
        if kind == 'telemetry':
            q = self._q(str(m.get('q')))
            self.store.set(q, m.get('value'), force=True)
            self.log('info', 'inspector override: %s = %r' % (q, m.get('value')))
            self.emit_telemetry(force=True)
        elif kind == 'faults':
            self.set_faults(m.get('faults') or [])
        elif kind == 'warp':
            self.clock.warp = parse_warp(m.get('value'))

    def set_faults(self, faults):
        self.faults = [f for f in faults if isinstance(f, dict)]
        keys = set(_fault_key(f) for f in self.faults)
        self.consumed &= keys
        want_freeze = set(self._q(str(f.get('q'))) for f in self.faults if f.get('kind') == 'freeze_param')
        want_drop = set(self._q(str(f.get('q'))) for f in self.faults if f.get('kind') == 'drop_param')
        now = self.clock.now
        for q in self._frozen - want_freeze:
            self.store.get(q).frozen_at = None
            self.log('info', 'fault cleared: freeze_param %s' % q)
        for q in want_freeze - self._frozen:
            self.store.get(q).frozen_at = now
            self.log('warning', 'fault armed: freeze_param %s (telemetry stops refreshing)' % q)
        for q in self._dropped - want_drop:
            self.store.get(q).dropped = False
            self.log('info', 'fault cleared: drop_param %s' % q)
        for q in want_drop - self._dropped:
            self.store.get(q).dropped = True
            self.log('warning', 'fault armed: drop_param %s (no telemetry received)' % q)
        self._frozen, self._dropped = want_freeze, want_drop

    def take_command_fault(self, q, cls):
        """Return 'fail' | 'timeout' | None for a command being issued (consumes `once` faults)."""
        for f in self.faults:
            kind = f.get('kind')
            if kind not in ('command_fails', 'command_timeout'):
                continue
            key = _fault_key(f)
            once = f.get('once', True)
            if once and key in self.consumed:
                continue
            match = f.get('match') or ''
            if match and match not in q and match != cls and match not in (cls or ''):
                continue
            if once:
                self.consumed.add(key)
            return 'fail' if kind == 'command_fails' else 'timeout'
        return None

    # ---- effects ------------------------------------------------------------------------------
    def matching_effects(self, q, cls, args):
        out = []
        for e in self.effects:
            c = e.get('command')
            if not c:
                continue
            if not (c == q or c == cls or ('*' in c and (fnmatch.fnmatchcase(q, c) or fnmatch.fnmatchcase(cls or '', c)))):
                continue
            when = e.get('when')
            if when and not all(values_match(args.get(k), v) for k, v in when.items()):
                continue
            out.append(e)
        return out

    def eval_expr(self, expr, args, prev):
        names = {'args': args, 'prev': prev, 't': self.clock.now}
        for k, v in args.items():
            if isinstance(k, str) and k.isidentifier():
                names.setdefault(k, v)
        return eval(expr, dict(_EVAL_GLOBALS), names)

    def apply_set(self, set_spec, args):
        for pq, spec in (set_spec or {}).items():
            q = self._q(pq)
            prev = self.store.value(q)
            try:
                if isinstance(spec, dict) and 'fromArg' in spec:
                    value = args.get(spec['fromArg'])
                elif isinstance(spec, dict) and 'add' in spec:
                    value = (prev or 0) + spec['add']
                elif isinstance(spec, dict) and 'expr' in spec:
                    value = self.eval_expr(spec['expr'], args, prev)
                else:
                    value = spec
            except Exception as exc:  # a broken expression must not kill the run
                self.log('error', 'sim effect for %s failed: %s: %s' % (q, type(exc).__name__, exc))
                continue
            self.store.set(q, value, force=True)

    def apply_effects(self, effects, args):
        for e in effects:
            self.apply_set(e.get('set'), args)
            for pq in e.get('sample') or []:
                self.store.get(self._q(pq)).force_sample(self.clock.now)
            for then in e.get('then') or []:
                after = float(then.get('after', 0))
                self.clock.schedule(after, lambda th=then, a=args: self.apply_set(th.get('set'), a))

    def finish(self):
        self.emit_telemetry(force=True)
