"""Telemetry store: per-parameter value history + sampling model.

A parameter has a "true" value (changed by command effects / UI overrides, optionally ramping with
a constant rate) and is *sampled* every `cadence` virtual seconds. Reads from the cache return the
latest sample; fresh reads wait for a sample newer than the read start. Frozen / dropped parameters
stop producing samples, which exercises the timeout / prompt paths of procedures.
"""
import math
import zlib

EPS = 1e-9
MAX_HIST = 32


def default_for(info, catalog):
    if info is None:
        return 0
    t = info.get('type')
    if info.get('kind') == 'aggregate':
        return {}
    if t == 'enum':
        members = catalog.enum_members(info.get('enum'), 'paramEnums') if catalog else None
        return members[0]['value'] if members else ''
    if t == 'float':
        return 0.0
    if t == 'int':
        return 0
    if t == 'bool':
        return False
    if t == 'str':
        return ''
    return 0


def coerce_value(info, catalog, v):
    """Best-effort conversion of a sim / UI value to the parameter's type (never raises)."""
    if info is None or v is None:
        return v
    t = info.get('type')
    try:
        if t == 'enum':
            members = (catalog.enum_members(info.get('enum'), 'paramEnums') if catalog else None) or []
            s = str(v)
            for m in members:
                if str(m['value']) == s:
                    return m['value']
            for m in members:
                if m['name'] == s:
                    return m['value']
            low = s.casefold()
            for m in members:
                if str(m['value']).casefold() == low or m['name'].casefold() == low:
                    return m['value']
            return v
        if t == 'float':
            return float(v)
        if t == 'int':
            f = float(v)
            return int(f) if f == int(f) else f
        if t == 'bool':
            if isinstance(v, str):
                return v.strip().lower() in ('1', 'true', 'yes', 'on')
            return bool(v)
        if t == 'str':
            return str(v)
    except (TypeError, ValueError):
        return v
    return v


def _is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


class Param(object):
    def __init__(self, q, info, catalog, initial, cadence, rate=0.0):
        self.q = q
        self.info = info
        self.catalog = catalog
        self.cadence = float(cadence)
        self.phase = (zlib.crc32(q.encode('utf-8')) % 1000) / 1000.0 * self.cadence if self.cadence > 0 else 0.0
        self.rate = rate or 0
        self.hist = [(0.0, initial)]
        self.forced = 0.0
        self.frozen_at = None
        self.dropped = False

    # ---- true value ---------------------------------------------------------------------------
    def value_at(self, t):
        base = self.hist[0]
        for entry in reversed(self.hist):
            if entry[0] <= t + EPS:
                base = entry
                break
        et, v = base
        if self.rate and _is_num(v):
            nv = v + self.rate * (t - et)
            if isinstance(v, int) and float(self.rate).is_integer():
                nv = int(math.floor(nv + EPS))
            return nv
        return v

    def set(self, value, t, force=True):
        self.hist.append((t, value))
        if len(self.hist) > MAX_HIST:
            del self.hist[0]
        if force and self.frozen_at is None and not self.dropped:
            self.forced = max(self.forced, t)

    def force_sample(self, t):
        if self.frozen_at is None and not self.dropped:
            self.forced = max(self.forced, t)

    # ---- sampling -----------------------------------------------------------------------------
    def last_sample_t(self, now):
        if self.dropped:
            return None
        cap = now if self.frozen_at is None else min(now, self.frozen_at)
        t = 0.0
        if self.cadence > 0:
            k = math.floor((cap - self.phase) / self.cadence + EPS)
            tick = self.phase + k * self.cadence
            if tick > t:
                t = tick
        if t < self.forced <= cap + EPS:
            t = self.forced
        return t

    def sample(self, now):
        """(value, sample_time) of the latest sample, or None if nothing was ever received."""
        t = self.last_sample_t(now)
        if t is None:
            return None
        return self.value_at(t), t

    def next_tick_after(self, now):
        if self.dropped or self.frozen_at is not None or self.cadence <= 0:
            return None
        k = math.floor((now - self.phase) / self.cadence + EPS) + 1
        return self.phase + k * self.cadence

    def raw_of(self, value):
        if self.info and self.info.get('type') == 'enum' and self.catalog:
            for i, m in enumerate(self.catalog.enum_members(self.info.get('enum'), 'paramEnums') or []):
                if m['value'] == value:
                    return i
        return value


class Store(object):
    def __init__(self, world, catalog, initial, cadence, rates, default_cadence):
        self.world = world
        self.catalog = catalog
        self.params = {}
        self.cadence_map = cadence
        self.rate_map = rates
        self.default_cadence = default_cadence
        self.initial = initial
        self.has_rates = bool(rates)

    def info(self, q):
        return self.catalog.param_info(q) if self.catalog else None

    def get(self, q):
        p = self.params.get(q)
        if p is None:
            info = self.info(q)
            if q in self.initial:
                init = coerce_value(info, self.catalog, self.initial[q])
            else:
                init = default_for(info, self.catalog)
            cadence = self.cadence_map.get(q, self.default_cadence)
            p = Param(q, info, self.catalog, init, cadence if cadence is not None else 0, self.rate_map.get(q, 0))
            self.params[q] = p
            self.world.dirty = True
        return p

    def set(self, q, value, force=True):
        p = self.get(q)
        p.set(coerce_value(p.info, self.catalog, value), self.world.clock.now, force)
        self.world.dirty = True

    def value(self, q):
        return self.get(q).value_at(self.world.clock.now)

    def snapshot(self):
        now = self.world.clock.now
        return {q: p.value_at(now) for q, p in self.params.items()}
