"""Convert UI argument values to what the entrypoint annotation expects (like the old CLI did)."""
import ast
import datetime as _dt
import enum
import inspect
import typing


def _is_union(origin):
    if origin is typing.Union:
        return True
    ut = getattr(__import__('types'), 'UnionType', None)
    return ut is not None and origin is ut


def convert(value, ann, name):
    if ann is inspect.Parameter.empty or ann is typing.Any:
        return value
    origin = typing.get_origin(ann)
    targs = typing.get_args(ann)
    if _is_union(origin):
        non_none = [a for a in targs if a is not type(None)]
        if value is None or (isinstance(value, str) and value.strip() == '' and len(non_none) != len(targs)):
            return None
        last_exc = None
        for a in non_none:
            try:
                return convert(value, a, name)
            except (ValueError, TypeError) as exc:
                last_exc = exc
        raise last_exc or ValueError('cannot convert')
    if isinstance(ann, type) and issubclass(ann, enum.Enum):
        if isinstance(value, ann):
            return value
        s = str(value)
        for m in ann:
            if m.value == value or str(m.value) == s:
                return m
        for m in ann:
            if m.name == s:
                return m
        low = s.strip().casefold()
        for m in ann:
            if str(m.value).casefold() == low or m.name.casefold() == low:
                return m
        raise ValueError('%r is not one of %s' % (value, ', '.join(repr(m.value) for m in ann)))
    base = origin or ann
    if base is bool:
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            low = value.strip().lower()
            if low == 'true':
                return True
            if low == 'false':
                return False
            raise ValueError("expected 'true' or 'false', got %r" % value)
        return bool(value)
    if base is int:
        if isinstance(value, str):
            return int(value.strip())
        if isinstance(value, float) and value != int(value):
            raise ValueError('expected an integer, got %r' % value)
        return int(value)
    if base is float:
        return float(value.strip() if isinstance(value, str) else value)
    if base is str:
        return value if isinstance(value, str) else str(value)
    if base is _dt.datetime or (isinstance(base, type) and issubclass(base, _dt.datetime)):
        if isinstance(value, _dt.datetime):
            return value
        from framework.utils.commanding import create_utc_time
        return create_utc_time(str(value))
    if base in (list, tuple, set, dict, frozenset):
        v = value
        if isinstance(v, str):
            v = ast.literal_eval(v)
        return base(v) if not isinstance(v, base) else v
    if inspect.isabstract(base) or getattr(base, '__module__', '') == 'collections.abc':
        return ast.literal_eval(value) if isinstance(value, str) else value
    if isinstance(base, type):
        if isinstance(value, base):
            return value
        return base(value)
    return value
