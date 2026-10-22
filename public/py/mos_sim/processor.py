"""A stand-in for the yamcs-client objects used by framework.mdb.super_class."""
import datetime as _dt
import json

from . import bridge
from .world import DEFAULT_AWAIT_TIMEOUT

_world = None


def set_world(w):
    global _world
    _world = w


def world():
    if _world is None:
        raise RuntimeError('No active run: the mock spacecraft only exists while a procedure is running')
    return _world


def now_utc():
    """Timezone-aware 'now' on the virtual clock (real clock if there is no active run)."""
    if _world is None:
        return _dt.datetime.now(_dt.timezone.utc)
    return _world.clock.utc()


class ParameterValue(object):
    def __init__(self, name, eng_value, raw_value, generation_time, reception_time):
        self.name = name
        self.eng_value = eng_value
        self.raw_value = raw_value
        self.generation_time = generation_time
        self.reception_time = reception_time
        self.acquisition_time = generation_time
        self.validity = 'VALID'
        self.monitoring_result = None
        self.range_condition = None

    def __repr__(self):
        return '<ParameterValue %s=%r @ %s>' % (self.name, self.eng_value, self.reception_time)

    __str__ = __repr__


class MonitoredCommand(object):
    """Mock of yamcs.tmtc.model.MonitoredCommand (also used as IssuedCommand)."""

    def __init__(self, world, q, args, comment):
        self.world = world
        clock = world.clock
        world.cmd_seq += 1
        self.id = 'cmd-%d' % world.cmd_seq
        self.name = q
        self.comment = comment
        self.arguments = dict(args or {})
        info = world.catalog.command_info(q) if world.catalog else None
        self.cls = info['key'] if info else q.rsplit('/', 1)[-1]
        self.generation_time = clock.utc()
        self.issue_t = clock.now
        self.error = None
        self.acknowledgments = {'Queued': 'OK'}
        self.status = 'issued'
        self.done = False
        self.complete_t = None

        world.emit({'type': 'command', 'q': q, 'cls': self.cls, 'args': self.arguments, 'status': 'issued'})
        world.store.set(world.counter_q, (world.store.value(world.counter_q) or 0) + 1, force=True)

        self.fate = world.take_command_fault(q, self.cls)
        self.effects = world.matching_effects(q, self.cls, self.arguments)
        delays = [e['delay'] for e in self.effects if e.get('delay') is not None]
        latency = float(delays[0]) if delays else world.rng.uniform(*world.latency)
        if self.fate == 'timeout':
            self.acknowledgments['Released'] = 'OK'
            self.event = None
        else:
            self.complete_t = clock.now + latency
            self.event = clock.schedule(latency, self._complete)

    def _complete(self):
        w = self.world
        self.acknowledgments['Released'] = 'OK'
        self.acknowledgments['Acknowledge_Sent'] = 'OK'
        failing = self.fate == 'fail'
        reason = 'Command failed (injected fault)'
        if not failing and any(e.get('fail') for e in self.effects):
            failing = True
            reason = 'Command failed (sim effect)'
        self.done = True
        if failing:
            self.status = 'failed'
            self.error = reason
            self.acknowledgments['CommandComplete'] = 'NOK'
        else:
            self.status = 'completed'
            self.acknowledgments['CommandComplete'] = 'OK'
            w.apply_effects(self.effects, self.arguments)
        w.emit({'type': 'command', 'q': self.name, 'cls': self.cls, 'args': self.arguments, 'status': self.status,
                **({'error': self.error} if self.error else {})})

    def is_complete(self):
        return self.done

    def is_success(self):
        return self.done and self.status == 'completed'

    def await_complete(self, timeout=None):
        w = self.world
        clock = w.clock
        deadline = clock.now + (DEFAULT_AWAIT_TIMEOUT if timeout is None else float(timeout))
        while not self.done:
            if clock.now >= deadline - 1e-9:
                break
            target = deadline
            if self.complete_t is not None and self.complete_t < target:
                target = self.complete_t
            clock.sleep(max(0.0, target - clock.now))
        if not self.done and self.status != 'timeout':
            self.status = 'timeout'
            self.error = 'Timed out waiting for command completion'
            w.emit({'type': 'command', 'q': self.name, 'cls': self.cls, 'args': self.arguments,
                    'status': 'timeout', 'error': self.error})
        return self

    def __repr__(self):
        return '<MonitoredCommand %s %s>' % (self.name, self.status)


class CommandConnection(object):
    def issue(self, command, args=None, comment=None, **kwargs):
        return MonitoredCommand(world(), command, args, comment)


class Subscription(object):
    def cancel(self):
        pass


class Processor(object):
    """Mock of the YAMCS realtime processor."""

    def get_parameter_value(self, parameter, from_cache=True, timeout=10):
        w = world()
        clock = w.clock
        p = w.store.get(parameter)
        pv = None
        if from_cache:
            s = p.sample(clock.now)
            if s is not None:
                pv = self._pv(p, s)
        else:
            timeout = 10 if timeout is None else float(timeout)
            start = clock.now
            deadline = start + timeout
            while True:
                s = p.sample(clock.now)
                if s is not None and s[1] > start + 1e-9:
                    pv = self._pv(p, s)
                    break
                if clock.now >= deadline - 1e-9:
                    break
                target = deadline
                nxt = p.next_tick_after(clock.now)
                if nxt is not None and nxt < target:
                    target = nxt
                ev = clock.next_event_time()
                if ev is not None and clock.now < ev < target:
                    target = ev
                clock.sleep(max(0.0, target - clock.now))
        w.emit({'type': 'tm', 'q': parameter, 'cls': p.info['key'] if p.info else None,
                'value': pv.eng_value if pv is not None else None, 'fresh': not from_cache})
        return pv

    def _pv(self, p, sample):
        value, t = sample
        when = world().clock.utc(t)
        return ParameterValue(p.q, value, p.raw_of(value), when, when)

    def issue_command(self, command, args=None, comment=None, **kwargs):
        return MonitoredCommand(world(), command, args, comment)

    def create_command_connection(self):
        return CommandConnection()

    def create_parameter_subscription(self, parameters, on_data=None, **kwargs):
        return Subscription()


_processor = Processor()


def get_processor():
    return _processor
