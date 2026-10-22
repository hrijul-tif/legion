"""Python side of the JS bridge (`mos_bridge`, registered by the run worker / test harness).

JS functions (all synchronous):
  emit(json: str)                      post one event (or a JSON array of events) to the UI
  sleep(real_seconds: float) -> bool   block (Atomics.wait in short slices); True if interrupted
  prompt(json: str) -> int             post a prompt event and block until the UI answers;
                                       returns the chosen index, or -1 when interrupted
  read_mailbox() -> str                JSON array of pending control messages ('' if none)
  interrupted() -> bool                True when the UI requested Stop
  clear_interrupt()                    reset the interrupt flag (so cleanup code after the KeyboardInterrupt
                                       is not interrupted again by Pyodide's own signal check)
"""
import json
import time as _time

try:  # only available inside the worker / test harness
    import mos_bridge as _js
except ImportError:  # plain CPython
    _js = None

# real clock functions, captured before the virtual clock patches the `time` module
real_time = _time.time
real_sleep = _time.sleep

# Optional python-side hooks for tests on plain CPython
sink = []                    # events are appended here when there is no JS bridge
scripted_answers = []        # prompt answers (choice strings or indices) when there is no JS bridge


def _default(o):
    try:
        return str(o)
    except Exception:  # pragma: no cover
        return repr(o)


def send(ev):
    if _js is not None:
        _js.emit(json.dumps(ev, default=_default))
    else:
        sink.append(ev)


def _raise_interrupt():
    clear = getattr(_js, 'clear_interrupt', None)
    if clear is not None:
        clear()
    raise KeyboardInterrupt()


def sleep(seconds):
    if _js is not None:
        if _js.sleep(float(seconds)):
            _raise_interrupt()
    elif seconds:
        real_sleep(min(seconds, 0.001))


def check_interrupt():
    if _js is not None and _js.interrupted():
        _raise_interrupt()


def read_mailbox():
    if _js is None:
        return []
    raw = _js.read_mailbox()
    if not raw:
        return []
    try:
        msgs = json.loads(raw)
    except ValueError:
        return []
    return msgs if isinstance(msgs, list) else []


def prompt(ev):
    """`ev` is the full prompt event dict (type/id/message/choices/t/wall). Returns the chosen index."""
    if _js is not None:
        idx = _js.prompt(json.dumps(ev, default=_default))
        idx = int(idx)
        if idx < 0 or idx >= len(ev['choices']):
            _raise_interrupt()
        return idx
    sink.append(ev)
    if not scripted_answers:
        raise KeyboardInterrupt()
    ans = scripted_answers.pop(0)
    return ans if isinstance(ans, int) else ev['choices'].index(ans)
