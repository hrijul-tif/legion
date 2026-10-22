"""Catalog-backed lazy module (generated classes appear on first attribute access)."""
from typing import Any

from framework._catalog import LazyModule as _LazyModule

_lazy = _LazyModule('JTYU', 'commands', __name__)


def __getattr__(name: str) -> Any:
    return _lazy.getattr(name)


def __dir__() -> list:
    return _lazy.dir()
