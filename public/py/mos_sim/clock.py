"""Virtual clock: `time.sleep`/`time.time` (and friends) inside procedures run on virtual time.

Real waiting = virtual / warp (warp = inf: no real wait). Scheduled events (command completions,
delayed telemetry effects) fire in virtual-time order while the clock advances. Between every
slice the world is polled so that Stop / telemetry overrides / fault toggles are honoured.
"""
import datetime as _dtmod
import heapq
import math
import time as _time

from . import bridge

_RealDatetime = _dtmod.datetime
SLICE_REAL = 0.05  # max real seconds between control polls while really waiting


class _VMeta(type):
    def __instancecheck__(cls, inst):
        return isinstance(inst, _RealDatetime)

    def __subclasscheck__(cls, sub):
        return issubclass(sub, _RealDatetime)


class Clock(object):
    def __init__(self, world, warp=1.0):
        self.world = world
        self.warp = warp
        self.now = 0.0                       # virtual seconds since run start
        self.epoch = bridge.real_time()      # unix time of virtual t=0
        self._heap = []
        self._seq = 0
        self._patched = None

    # ---- virtual <-> wall-clock datetimes -------------------------------------------------
    def unix(self, t=None):
        return self.epoch + (self.now if t is None else t)

    def utc(self, t=None):
        """Timezone-aware UTC datetime for virtual time t (default: now)."""
        return _RealDatetime.fromtimestamp(self.unix(t), _dtmod.timezone.utc)

    # ---- scheduler -------------------------------------------------------------------------
    def schedule(self, delay, fn):
        self._seq += 1
        item = [self.now + max(0.0, delay), self._seq, fn, False]
        heapq.heappush(self._heap, item)
        return item

    def cancel(self, handle):
        handle[3] = True

    def next_event_time(self):
        while self._heap and self._heap[0][3]:
            heapq.heappop(self._heap)
        return self._heap[0][0] if self._heap else None

    def _advance(self, t_end):
        while True:
            nxt = self.next_event_time()
            if nxt is None or nxt > t_end:
                break
            item = heapq.heappop(self._heap)
            if item[0] > self.now:
                self.now = item[0]
            item[2]()
        if t_end > self.now:
            self.now = t_end
        self.world.after_advance()

    # ---- sleeping ---------------------------------------------------------------------------
    def sleep(self, seconds):
        seconds = float(seconds)
        if seconds < 0:
            raise ValueError('sleep length must be non-negative')
        target = self.now + seconds
        self.world.pump()
        inf = math.isinf(self.warp)
        while True:
            remaining = target - self.now
            if remaining <= 0:
                # still run events scheduled exactly at / before now
                self._advance(self.now)
                break
            step = remaining if inf else min(remaining, SLICE_REAL * self.warp)
            t_end = target if step >= remaining else self.now + step
            self._advance(t_end)
            if not inf:
                bridge.sleep(step / self.warp)
            self.world.pump()

    # ---- patching the stdlib so procedures see virtual time ---------------------------------
    def patch(self):
        clock = self

        class VDatetime(_RealDatetime, metaclass=_VMeta):
            @classmethod
            def now(cls, tz=None):
                aware = clock.utc()
                if tz is None:
                    return _RealDatetime(aware.year, aware.month, aware.day, aware.hour, aware.minute,
                                         aware.second, aware.microsecond)  # sandbox local time is UTC
                return aware.astimezone(tz)

            @classmethod
            def utcnow(cls):
                a = clock.utc()
                return _RealDatetime(a.year, a.month, a.day, a.hour, a.minute, a.second, a.microsecond)

            @classmethod
            def today(cls):
                return cls.now()

        saved = dict(
            time=_time.time, sleep=_time.sleep, monotonic=_time.monotonic,
            perf_counter=_time.perf_counter, datetime=_dtmod.datetime,
        )
        _time.time = lambda: clock.unix()
        _time.sleep = clock.sleep
        _time.monotonic = lambda: 1000.0 + clock.now
        _time.perf_counter = lambda: clock.now
        _dtmod.datetime = VDatetime
        self._patched = saved

    def unpatch(self):
        saved, self._patched = self._patched, None
        if not saved:
            return
        _time.time = saved['time']
        _time.sleep = saved['sleep']
        _time.monotonic = saved['monotonic']
        _time.perf_counter = saved['perf_counter']
        _dtmod.datetime = saved['datetime']
