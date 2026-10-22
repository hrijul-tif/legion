"""MOS procedure checker.

Produces Monaco-friendly diagnostics (1-based lines and columns, UTF-16 columns) plus the
parsed entry-function signature.  Keep this file Python 3.8/3.9 compatible.

Diagnostic codes
  MOS000 error    syntax error
  MOS001 error    no public top-level function
  MOS002 error    more than one public top-level function
  MOS003 error    entry argument without type annotation
  MOS004 error    unsupported argument annotation
  MOS005 error    import not allowed
  MOS006 error    forbidden call (input / exec / eval / __import__ / os.system / subprocess.*)
  MOS007 warning  file access or absolute / home-relative path literal
  MOS008 warning  MISSION constant does not match the procedure's mission
  MOS009 info     time.sleep with a literal longer than 600 s
"""

import ast
import json
import re

ALLOWED_STDLIB = frozenset(
    [
        "operator", "time", "datetime", "math", "re", "json", "enum", "typing", "dataclasses",
        "collections", "itertools", "functools", "statistics", "random", "string", "textwrap",
        "copy", "decimal", "fractions", "logging", "__future__",
    ]
)

CROSS_PROCEDURE_MSG = "cross-procedure/shared-helper imports are not available in the MOS sandbox"

# root module -> tailored message
TAILORED_IMPORTS = {
    "utils": CROSS_PROCEDURE_MSG,
    "src": CROSS_PROCEDURE_MSG,
    "ops": CROSS_PROCEDURE_MSG,
    "yamcs_utils": CROSS_PROCEDURE_MSG,
    "inquirer": "interactive prompts are handled by MOS; use the framework prompt helpers instead",
    "subprocess": "spawning processes is not possible in the MOS sandbox",
    "os": "the os module is not available in the MOS sandbox (no file system or process access)",
    "sys": "the sys module is not available in the MOS sandbox",
    "requests": "network access is not available in the MOS sandbox; telemetry and commands go through framework.*",
    "pandas": "pandas is not available in the MOS sandbox",
    "slack_sdk": "Slack notifications are handled by MOS, not by procedures",
    "jira": "Jira access is handled by MOS, not by procedures",
    "gspread": "Google Sheets access is not available in the MOS sandbox",
    "googleapiclient": "Google API access is not available in the MOS sandbox",
    "paramiko": "SSH access is not available in the MOS sandbox",
    "git": "git access is not available in the MOS sandbox",
}

FORBIDDEN_BUILTIN_CALLS = {
    "input": "input() is not available; interactive prompts are handled by MOS (use the framework prompt helpers)",
    "exec": "exec() is not allowed in procedures",
    "eval": "eval() is not allowed in procedures",
    "__import__": "__import__() is not allowed in procedures",
}

FORBIDDEN_QUALIFIED_CALLS = {
    "os.system": "os.system() is not allowed in procedures",
    "os.popen": "os.popen() is not allowed in procedures",
}

PATH_LITERAL_RE = re.compile(
    r"^(~[/\\]|/(Users|home|tmp|var|etc|opt|mnt|root|Volumes|usr|Documents)(/|$)|[A-Za-z]:[\\/])"
)

SCALAR_TYPES = {"str", "int", "float", "bool", "datetime"}
LIST_NAMES = {"list", "List"}
MODULE_RE = re.compile(r"^framework\.(\w+)\.(commands|parameters)$")

SUPPORTED_HINT = (
    "supported: str, int, float, bool, datetime, list[...], List[...], "
    "or <alias>.<Enum> from framework commands/parameters"
)


def _u16(s):
    """UTF-16 length of ``s``."""
    return len(s) + sum(1 for ch in s if ord(ch) > 0xFFFF)


class _Ctx(object):
    def __init__(self, code):
        self.code = code
        self.lines = code.split("\n")
        self.diags = []

    def col(self, line, byte_off):
        """ast byte offset -> 1-based UTF-16 column."""
        text = self.lines[line - 1] if 0 < line <= len(self.lines) else ""
        prefix = text.encode("utf-8")[:byte_off].decode("utf-8", "ignore")
        return _u16(prefix) + 1

    def range_of(self, node):
        sl = node.lineno
        el = getattr(node, "end_lineno", None) or sl
        sc = self.col(sl, node.col_offset)
        ec_off = getattr(node, "end_col_offset", None)
        ec = self.col(el, ec_off) if ec_off is not None else sc + 1
        return sl, sc, el, ec

    def add(self, code, severity, message, node=None, rng=None):
        if rng is None:
            rng = self.range_of(node) if node is not None else (1, 1, 1, 2)
        self.diags.append(
            {
                "code": code,
                "severity": severity,
                "message": message,
                "startLine": rng[0],
                "startColumn": rng[1],
                "endLine": rng[2],
                "endColumn": rng[3],
            }
        )


def _dotted(node):
    """Attribute/Name chain -> 'a.b.c' or None."""
    parts = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if isinstance(node, ast.Name):
        parts.append(node.id)
        return ".".join(reversed(parts))
    return None


def _collect_bindings(tree):
    """local name -> fully qualified dotted module/object name, for every import in the file."""
    b = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                if a.asname:
                    b[a.asname] = a.name
                else:
                    root = a.name.split(".")[0]
                    b[root] = root
        elif isinstance(node, ast.ImportFrom) and node.module and not node.level:
            for a in node.names:
                if a.name != "*":
                    b[a.asname or a.name] = node.module + "." + a.name
    return b


def _resolve(dotted, bindings):
    if not dotted:
        return None
    first, _, rest = dotted.partition(".")
    base = bindings.get(first, first)
    return base + ("." + rest if rest else "")


# ---------------------------------------------------------------- annotations

def _classify_annotation(node, bindings, enums, code):
    """Return a descriptor dict for a supported annotation, else None.

    {'kind': 'str'|'int'|'float'|'bool'|'datetime'|'list'|'enum', 'item'?: descriptor,
     'enum'?: str, 'enumModule'?: 'commands'|'parameters', 'mission'?: str}
    """
    if isinstance(node, ast.Constant) and isinstance(node.value, str):  # forward reference
        try:
            inner = ast.parse(node.value.strip(), mode="eval").body
        except SyntaxError:
            return None
        return _classify_annotation(inner, bindings, enums, code)

    if isinstance(node, ast.Name):
        if node.id in SCALAR_TYPES:
            return {"kind": node.id}
        if node.id in LIST_NAMES:
            return {"kind": "list"}
        # `from datetime import datetime` / `from typing import List` are covered by the names above
        return None

    if isinstance(node, ast.Attribute):
        dotted = _resolve(_dotted(node), bindings)
        if dotted in ("datetime.datetime",):
            return {"kind": "datetime"}
        if dotted == "typing.List":
            return {"kind": "list"}
        owner = _resolve(_dotted(node.value), bindings)
        m = MODULE_RE.match(owner or "")
        if m:
            module = m.group(2)
            if enums is not None and node.attr not in set(enums.get(module, [])):
                return None
            return {"kind": "enum", "enum": node.attr, "enumModule": module, "mission": m.group(1)}
        return None

    if isinstance(node, ast.Subscript):
        base = node.value
        base_name = _resolve(_dotted(base), bindings)
        is_list = (isinstance(base, ast.Name) and base.id in LIST_NAMES) or base_name in ("typing.List", "builtins.list")
        if not is_list:
            return None
        sl = node.slice
        if hasattr(ast, "Index") and isinstance(sl, getattr(ast, "Index")):  # Python < 3.9
            sl = sl.value  # type: ignore[attr-defined]
        item = _classify_annotation(sl, bindings, enums, code)
        if item is None:
            return None
        return {"kind": "list", "item": item}

    return None


def _literal_default(node):
    try:
        value = ast.literal_eval(node)
        json.dumps(value)
        return True, value
    except Exception:  # noqa: BLE001 - any non-literal default
        return False, None


def _entry_info(ctx, fn, bindings, enums):
    params = []
    args = fn.args
    positional = list(getattr(args, "posonlyargs", [])) + list(args.args)
    n_def = len(args.defaults)
    defaults = {}
    for a, d in zip(positional[len(positional) - n_def:], args.defaults):
        defaults[id(a)] = d
    for a, d in zip(args.kwonlyargs, args.kw_defaults):
        if d is not None:
            defaults[id(a)] = d

    def describe(a, position):
        entry = {"name": a.arg, "position": position, "required": id(a) not in defaults}
        ann = a.annotation
        if ann is None:
            ctx.add(
                "MOS003",
                "error",
                "Argument '%s' of the entry function needs a type annotation (%s)." % (a.arg, SUPPORTED_HINT),
                a,
            )
            entry["annotation"] = None
            entry["kind"] = "unknown"
        else:
            text = ast.get_source_segment(ctx.code, ann) or ""
            entry["annotation"] = text
            desc = _classify_annotation(ann, bindings, enums, ctx.code)
            if desc is None:
                ctx.add(
                    "MOS004",
                    "error",
                    "Unsupported annotation '%s' for argument '%s' (%s)." % (text, a.arg, SUPPORTED_HINT),
                    ann,
                )
                entry["kind"] = "unknown"
            else:
                entry.update(desc)
        d = defaults.get(id(a))
        if d is not None:
            ok, value = _literal_default(d)
            if ok:
                entry["default"] = value
            else:
                entry["defaultExpr"] = ast.get_source_segment(ctx.code, d) or ""
        return entry

    for a in positional:
        params.append(describe(a, "positional"))
    for a in args.kwonlyargs:
        params.append(describe(a, "keyword_only"))
    if args.vararg is not None:
        ctx.add("MOS004", "error", "*%s is not supported on the entry function; declare explicit typed arguments." % args.vararg.arg, args.vararg)
    if args.kwarg is not None:
        ctx.add("MOS004", "error", "**%s is not supported on the entry function; declare explicit typed arguments." % args.kwarg.arg, args.kwarg)
    return params


# ------------------------------------------------------------------- imports

def _check_import(ctx, root, full, node):
    if root == "framework" or root in ALLOWED_STDLIB:
        return
    msg = TAILORED_IMPORTS.get(root)
    if msg:
        ctx.add("MOS005", "error", "Import '%s' is not allowed: %s." % (full, msg), node)
    else:
        ctx.add(
            "MOS005",
            "error",
            "Import '%s' is not allowed. Procedures may only import framework.* and: %s."
            % (full, ", ".join(sorted(m for m in ALLOWED_STDLIB if m != "__future__"))),
            node,
        )


def _check_imports(ctx, tree):
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                _check_import(ctx, a.name.split(".")[0], a.name, node)
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                ctx.add("MOS005", "error", "Relative imports are not available in the MOS sandbox: %s." % CROSS_PROCEDURE_MSG, node)
            elif node.module:
                _check_import(ctx, node.module.split(".")[0], node.module, node)


# --------------------------------------------------------------------- calls

def _docstring_ids(tree):
    ids = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            body = node.body
            if body and isinstance(body[0], ast.Expr):
                v = body[0].value
                if isinstance(v, ast.Constant) and isinstance(v.value, str):
                    ids.add(id(v))
    return ids


def _number(node):
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)) and not isinstance(node.value, bool):
        return node.value
    return None


def _check_calls_and_literals(ctx, tree, bindings):
    skip = _docstring_ids(tree)
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            func = node.func
            name = _resolve(_dotted(func), bindings)
            if isinstance(func, ast.Name) and func.id in FORBIDDEN_BUILTIN_CALLS and bindings.get(func.id) is None:
                ctx.add("MOS006", "error", FORBIDDEN_BUILTIN_CALLS[func.id] + ".", func)
            elif name in FORBIDDEN_QUALIFIED_CALLS:
                ctx.add("MOS006", "error", FORBIDDEN_QUALIFIED_CALLS[name] + ".", func)
            elif name and name.startswith("subprocess."):
                ctx.add("MOS006", "error", "%s() is not allowed: spawning processes is not possible in the MOS sandbox." % name, func)
            if isinstance(func, ast.Name) and func.id == "open" and bindings.get("open") is None:
                ctx.add("MOS007", "warning", "File access via open() is not available in the MOS sandbox.", func)
            elif isinstance(func, ast.Attribute) and func.attr in ("write_text", "write_bytes"):
                ctx.add("MOS007", "warning", "File writes (%s) are not available in the MOS sandbox." % func.attr, func)
            if name == "time.sleep" and node.args:
                secs = _number(node.args[0])
                if secs is not None and secs > 600:
                    ctx.add("MOS009", "info", "time.sleep(%s) waits longer than 600 s (%.1f min)." % (secs, secs / 60.0), node)
        elif isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in skip:
            if PATH_LITERAL_RE.match(node.value):
                ctx.add(
                    "MOS007",
                    "warning",
                    "Absolute or home-relative path '%s': the MOS sandbox has no access to your file system." % node.value,
                    node,
                )


# ------------------------------------------------------------------- mission

def _mission_ok(value, mission):
    v = value.strip().upper()
    if mission == "FF":
        return v.startswith("FF")
    if mission == "JTYU":
        return v == "JTYU"
    return True


def _check_mission_const(ctx, tree, mission):
    if mission not in ("FF", "JTYU"):
        return
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "MISSION" for t in node.targets):
            v = node.value
            if isinstance(v, ast.Constant) and isinstance(v.value, str) and not _mission_ok(v.value, mission):
                ctx.add(
                    "MOS008",
                    "warning",
                    "MISSION = %r does not match this procedure's mission %s." % (v.value, mission),
                    v,
                )


# ---------------------------------------------------------------------- main

def mos_check(code, mission=None, enums=None):
    """Run all MOS checks. ``enums`` optionally maps 'commands'/'parameters' -> known enum class names."""
    ctx = _Ctx(code)
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        line = e.lineno or 1
        text = ctx.lines[line - 1] if line <= len(ctx.lines) else ""
        start = (e.offset or 1)
        end_line = getattr(e, "end_lineno", None) or line
        end_off = getattr(e, "end_offset", None)
        sc = _u16(text[: max(start - 1, 0)]) + 1
        if end_line == line and end_off and end_off > start:
            ec = _u16(text[: end_off - 1]) + 1
        else:
            ec = max(_u16(text) + 1, sc + 1)
            end_line = line
        ctx.add("MOS000", "error", "Syntax error: %s" % (e.msg,), rng=(line, sc, end_line, ec))
        return {"diagnostics": ctx.diags, "entry": {"entrypoint": None, "params": []}}

    bindings = _collect_bindings(tree)
    funcs = [n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]
    public = [f for f in funcs if not f.name.startswith("_")]

    entry = {"entrypoint": None, "params": []}
    if not public:
        ctx.add(
            "MOS001",
            "error",
            "No entry function found. Define exactly one public top-level function; helper functions must start with '_'.",
        )
    else:
        if len(public) > 1:
            names = ", ".join(f.name for f in public)
            for f in public:
                ctx.add(
                    "MOS002",
                    "error",
                    "Multiple public top-level functions (%s). A procedure has exactly one entry function; prefix helpers with '_'." % names,
                    rng=_name_range(ctx, f),
                )
        fn = public[0]
        entry["entrypoint"] = fn.name
        entry["params"] = _entry_info(ctx, fn, bindings, enums)
        entry["line"] = fn.lineno
        entry["isAsync"] = isinstance(fn, ast.AsyncFunctionDef)
        doc = ast.get_docstring(fn)
        if doc:
            entry["doc"] = doc

    _check_imports(ctx, tree)
    _check_calls_and_literals(ctx, tree, bindings)
    _check_mission_const(ctx, tree, mission)
    ctx.diags.sort(key=lambda d: (d["startLine"], d["startColumn"], d["code"]))
    return {"diagnostics": ctx.diags, "entry": entry}


def _name_range(ctx, fn):
    """Range of the function name in its `def` line."""
    line = fn.lineno
    text = ctx.lines[line - 1] if line <= len(ctx.lines) else ""
    # decorators put fn.lineno on the def line in py3.8+
    m = re.search(r"\bdef\s+(%s)\b" % re.escape(fn.name), text)
    if m:
        sc = _u16(text[: m.start(1)]) + 1
        return line, sc, line, sc + _u16(fn.name)
    return ctx.range_of(fn)


def mos_check_json(code, mission=None, enums_json=None):
    enums = json.loads(enums_json) if enums_json else None
    return json.dumps(mos_check(code, mission, enums))
