"""Loggers used by procedures: run_logger, extra_logger (bus) and csv_logger.

In the sandbox all of them route to the UI console as `log` events; the `logger` field of the event
tells them apart ('run' | 'extra' | 'csv').
"""
import logging

from mos_sim import bridge

_LEVELS = {
    logging.DEBUG: 'debug',
    logging.INFO: 'info',
    logging.WARNING: 'warning',
    logging.ERROR: 'error',
    logging.CRITICAL: 'error',
}


class UIHandler(logging.Handler):
    def __init__(self, channel):
        logging.Handler.__init__(self)
        self.channel = channel

    def emit(self, record):
        try:
            msg = record.getMessage()
        except Exception:
            msg = str(record.msg)
        if record.exc_info:
            msg += '\n' + logging.Formatter().formatException(record.exc_info)
        ev = {'type': 'log', 'level': _LEVELS.get(record.levelno, 'info'), 'msg': msg, 'logger': self.channel}
        try:
            from mos_sim import processor
            if processor._world is not None:
                processor._world.emit(ev)
                return
        except Exception:
            pass
        ev['t'] = 0
        ev['wall'] = int(bridge.real_time() * 1000)
        bridge.send(ev)


def _make(name, channel):
    lg = logging.getLogger(name)
    lg.setLevel(logging.DEBUG)
    lg.propagate = False
    for h in list(lg.handlers):
        lg.removeHandler(h)
    lg.addHandler(UIHandler(channel))
    return lg


run_logger = _make('mos.run', 'run')
extra_logger = _make('mos.extra', 'extra')
csv_logger = _make('mos.csv', 'csv')
