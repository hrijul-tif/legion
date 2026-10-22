"""Unit tests for public/py/mos_lint/check.py.  Run: python3 scripts/test_mos_lint.py (Python >= 3.8)."""

import os
import sys
import unittest

sys.dont_write_bytecode = True  # keep public/py clean

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "public", "py"))

from mos_lint import mos_check  # noqa: E402

REAL = (
    "/Users/hrijul.bhatnagar/Files/Code/ff-procedures/ops/procedures/OPS/EPS/FCP/"
    "FF_AXX_FCP_EPS_181_Set_solar_panel_string_3_shunt_threshold.py"
)

HEADER = (
    "import framework.ff.commands as comm\n"
    "import framework.ff.parameters as param\n"
    "from framework.utils.log_helper import run_logger as logger\n"
)


def codes(res, severity=None):
    return [d["code"] for d in res["diagnostics"] if severity is None or d["severity"] == severity]


class MosLintTests(unittest.TestCase):
    def test_real_procedure_has_no_errors(self):
        if not os.path.exists(REAL):
            self.skipTest("real procedure not available")
        with open(REAL) as f:
            res = mos_check(f.read(), "FF")
        self.assertEqual(codes(res, "error"), [], res["diagnostics"])
        self.assertEqual(res["entry"]["entrypoint"], "Set_solar_panel_string_3_shunt_threshold_Procedure")
        p = res["entry"]["params"]
        self.assertEqual([(x["name"], x["kind"], x["annotation"]) for x in p],
                         [("Pus_Acknowledgement_Flags", "str", "str"), ("Threshold", "float", "float")])
        self.assertTrue(all(x["required"] for x in p))
        self.assertNotIn("MOS008", codes(res))

    def test_syntax_error(self):
        res = mos_check("def f(:\n  pass\n", "FF")
        self.assertEqual(codes(res), ["MOS000"])
        self.assertIsNone(res["entry"]["entrypoint"])
        d = res["diagnostics"][0]
        self.assertEqual(d["startLine"], 1)

    def test_no_public_function(self):
        res = mos_check(HEADER + "def _helper(x: int):\n    return x\n", "FF")
        self.assertIn("MOS001", codes(res, "error"))

    def test_multiple_public_functions(self):
        res = mos_check("def a(x: int):\n    pass\n\ndef b(y: int):\n    pass\n\ndef _c():\n    pass\n", "FF")
        self.assertEqual(codes(res).count("MOS002"), 2)
        self.assertIn("a, b", res["diagnostics"][0]["message"])

    def test_missing_annotation(self):
        res = mos_check("def run(x, y: int = 3):\n    pass\n", "FF")
        self.assertEqual([d["code"] for d in res["diagnostics"]], ["MOS003"])
        d = res["diagnostics"][0]
        self.assertEqual((d["startLine"], d["startColumn"], d["endColumn"]), (1, 9, 10))
        self.assertEqual(res["entry"]["params"][1]["default"], 3)
        self.assertFalse(res["entry"]["params"][1]["required"])

    def test_supported_annotations(self):
        src = (
            HEADER
            + "import cmd_alias_unused\n" * 0
            + "import framework.ff.parameters\n"
            + "from datetime import datetime\n"
            + "from typing import List\n"
            + "import typing\n"
            + "def run(a: str, b: int, c: float, d: bool, e: datetime, f: list[int], g: List[str],\n"
            + "        h: comm.PusAckFlagsEnum, i: param.AocsModeEnum, j: typing.List[float],\n"
            + "        k: 'list[comm.PusAckFlagsEnum]', l: framework.ff.parameters.SomeEnum = None, m: list = None):\n"
            + "    pass\n"
        )
        res = mos_check(src, "FF")
        self.assertEqual(codes(res, "error"), [], res["diagnostics"])
        kinds = {p["name"]: p for p in res["entry"]["params"]}
        self.assertEqual(kinds["h"]["kind"], "enum")
        self.assertEqual(kinds["h"]["enum"], "PusAckFlagsEnum")
        self.assertEqual(kinds["h"]["enumModule"], "commands")
        self.assertEqual(kinds["i"]["enumModule"], "parameters")
        self.assertEqual(kinds["f"]["item"]["kind"], "int")
        self.assertEqual(kinds["k"]["item"]["enum"], "PusAckFlagsEnum")
        self.assertEqual(kinds["l"]["enum"], "SomeEnum")
        self.assertIsNone(kinds["l"]["default"])

    def test_old_cmd_alias(self):
        src = "import framework.ff.commands as cmd\ndef run(x: cmd.PusAckFlagsEnum):\n    pass\n"
        self.assertEqual(codes(mos_check(src, "FF")), [])

    def test_unsupported_annotations(self):
        src = (
            HEADER
            + "from typing import Optional, Dict\n"
            + "def run(a: Optional[int], b: dict, c: param.SuperParameter.Foo.Bar, d: int | None, e: list[dict], f: Dict[str, int], g: 'Foo', *args, **kw):\n"
            + "    pass\n"
        )
        res = mos_check(src, "FF")
        errs = [d for d in res["diagnostics"] if d["code"] == "MOS004"]
        self.assertGreaterEqual(len(errs), 8)
        self.assertTrue(all(p["kind"] == "unknown" for p in res["entry"]["params"]))

    def test_unknown_enum_with_catalog(self):
        src = "import framework.ff.commands as comm\ndef run(x: comm.Nope, y: comm.Good):\n    pass\n"
        res = mos_check(src, "FF", {"commands": ["Good"], "parameters": []})
        self.assertEqual(codes(res), ["MOS004"])

    def test_imports(self):
        cases = {
            "from utils.jira import jira_client": "cross-procedure",
            "import src.foo": "cross-procedure",
            "from ops.procedures.OPS import x": "cross-procedure",
            "import inquirer": "interactive prompts",
            "import subprocess": "processes",
            "import requests": "network",
            "import pandas as pd": "pandas",
            "from slack_sdk import WebClient": "Slack",
            "import jira": "Jira",
            "import gspread": "Google",
            "from googleapiclient.discovery import build": "Google",
            "import paramiko": "SSH",
            "import git": "git",
            "import os": "os module",
            "import yaml": "may only import",
            "from . import sibling": "Relative",
        }
        for stmt, frag in cases.items():
            res = mos_check(stmt + "\ndef run(x: int):\n    pass\n", "FF")
            msgs = [d["message"] for d in res["diagnostics"] if d["code"] == "MOS005"]
            self.assertEqual(len(msgs), 1, (stmt, res["diagnostics"]))
            self.assertIn(frag, msgs[0], stmt)

    def test_allowed_imports(self):
        src = (
            "import operator, time, math, re, json, enum, typing, dataclasses, collections, itertools\n"
            "import functools, statistics, random, string, textwrap, copy, decimal, fractions, logging\n"
            "from datetime import datetime, timezone, timedelta\n"
            "from framework.settings import settings\n"
            "import framework.utils.commanding as ucomm\n"
            "from framework.utils.custom_exceptions import SkipProcedureError\n"
            "def run(x: int):\n    pass\n"
        )
        self.assertEqual(codes(mos_check(src, "FF")), [])

    def test_forbidden_calls(self):
        src = (
            "import os, subprocess\nimport subprocess as sp\nfrom os import system\n"
            "def run(x: int):\n"
            "    input('?')\n    os.system('ls')\n    subprocess.run(['ls'])\n    sp.Popen('x')\n"
            "    exec('1')\n    eval('1')\n    __import__('os')\n    system('x')\n"
        )
        res = mos_check(src, "FF")
        self.assertEqual(codes(res).count("MOS006"), 8, res["diagnostics"])

    def test_file_access_and_paths(self):
        src = (
            "def run(x: int):\n"
            "    open('a.txt', 'w')\n"
            "    p = '~/Documents/x.csv'\n"
            "    q = '/Users/me/x'\n"
            "    ok = '/FF/EPS/Swt_aocs3v3BkMn'\n"
            "    win = 'C:\\\\temp\\\\x'\n"
        )
        res = mos_check(src, "FF")
        w = [d for d in res["diagnostics"] if d["code"] == "MOS007"]
        self.assertEqual(len(w), 4, w)
        self.assertTrue(all(d["severity"] == "warning" for d in w))

    def test_mission_constant(self):
        mk = lambda v: "MISSION = %r\ndef run(x: int):\n    pass\n" % v
        self.assertEqual(codes(mos_check(mk("FF1"), "FF")), [])
        self.assertEqual(codes(mos_check(mk("ff2"), "FF")), [])
        self.assertEqual(codes(mos_check(mk("JTYU"), "FF")), ["MOS008"])
        self.assertEqual(codes(mos_check(mk("jtyu"), "JTYU")), [])
        self.assertEqual(codes(mos_check(mk("FF1"), "JTYU")), ["MOS008"])
        self.assertEqual(mos_check(mk("FF1"), "JTYU")["diagnostics"][0]["severity"], "warning")

    def test_long_sleep(self):
        src = "import time\nfrom time import sleep\nimport time as t\ndef run(x: int):\n    time.sleep(601)\n    sleep(1200)\n    t.sleep(600)\n    time.sleep(x)\n"
        res = mos_check(src, "FF")
        self.assertEqual(codes(res), ["MOS009", "MOS009"])
        self.assertEqual(res["diagnostics"][0]["severity"], "info")

    def test_ranges_utf16(self):
        src = "x = '😀'; y = input()\ndef run(a: int):\n    pass\n"
        res = mos_check(src, "FF")
        d = [d for d in res["diagnostics"] if d["code"] == "MOS006"][0]
        # '😀' counts as 2 UTF-16 units: "x = '😀'; y = " is 14 units -> column 15
        self.assertEqual((d["startLine"], d["startColumn"], d["endColumn"]), (1, 15, 20))

    def test_json_entry(self):
        import json
        from mos_lint import mos_check_json
        out = json.loads(mos_check_json("def run(a: int = 2, b: str = 'x'):\n    pass\n", "FF"))
        self.assertEqual(out["entry"]["entrypoint"], "run")
        self.assertEqual([p["default"] for p in out["entry"]["params"]], [2, "x"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
