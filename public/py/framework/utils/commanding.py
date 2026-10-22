"""Sandbox version of framework.utils.commanding.

The real module also has verify_parameter_values (thread pool + YAMCS); procedures only use
create_utc_time, which is mirrored here: parse a timestamp string and return it as UTC.
"""
import re
from datetime import datetime, timezone


def _parse(timestamp):
    ts = timestamp.strip()
    try:
        # real implementation uses dateutil.parser.parse; use it when this Pyodide has it
        from dateutil import parser as _dparser
        return _dparser.parse(ts)
    except ImportError:
        pass
    s = ts
    if s.endswith('Z') or s.endswith('z'):
        s = s[:-1] + '+00:00'
    # normalise fractional seconds to 6 digits (py < 3.11 fromisoformat is strict)
    s = re.sub(r'(\.\d+)', lambda mm: (mm.group(1) + '000000')[:7], s, count=1)
    try:
        return datetime.fromisoformat(s)
    except ValueError:
        pass
    for fmt in ('%Y-%m-%d %H:%M:%S', '%Y/%m/%d %H:%M:%S', '%d-%b-%Y %H:%M:%S', '%Y-%m-%d', '%d/%m/%Y %H:%M:%S'):
        try:
            return datetime.strptime(ts, fmt)
        except ValueError:
            continue
    raise ValueError('Unknown string format: %s' % timestamp)


def create_utc_time(timestamp: str) -> datetime:
    # naive timestamps are interpreted as local time by astimezone(); the sandbox TZ is UTC
    return _parse(timestamp).astimezone(timezone.utc)
