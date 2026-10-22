"""MOS procedure static checks (pure stdlib) and jedi-based editor intelligence.

``check`` has no third-party dependencies and runs on any Python >= 3.8 (so it can be
unit-tested with the system interpreter).  ``intel`` imports jedi lazily.
"""

from .check import mos_check, mos_check_json  # noqa: F401

__all__ = ["mos_check", "mos_check_json"]
