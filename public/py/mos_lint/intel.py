"""jedi-backed editor intelligence.  Lines are 1-based; ``column`` is the 0-based char offset
(Monaco column - 1).  All functions return JSON strings so the JS side just does JSON.parse.
"""

import json

import jedi
from jedi.api.environment import InterpreterEnvironment

PROJECT_ROOT = "/home/pyodide/mos_py"
SCRIPT_PATH = PROJECT_ROOT + "/_procedure.py"

_project = None
_last = {"key": None, "items": []}

_KIND = {
    "module": "module", "class": "class", "instance": "variable", "function": "function",
    "param": "parameter", "path": "file", "keyword": "keyword", "property": "property",
    "statement": "variable",
}


def _script(code):
    global _project
    if _project is None:
        _project = jedi.Project(PROJECT_ROOT)
    return jedi.Script(code, path=SCRIPT_PATH, project=_project, environment=InterpreterEnvironment())


def _doc(name, raw=False):
    try:
        return name.docstring(raw=raw)
    except Exception:  # noqa: BLE001
        return ""


def complete(code, line, column):
    script = _script(code)
    items = script.complete(line, column)
    _last["key"] = (code, line, column)
    _last["items"] = items
    out = []
    for i, c in enumerate(items):
        if c.name.startswith("__") and c.name.endswith("__"):
            sort = "z"
        elif c.name.startswith("_"):
            sort = "y"
        else:
            sort = "a"
        out.append({
            "i": i,
            "label": c.name,
            "kind": _KIND.get(c.type, "variable"),
            "detail": c.description or "",
            "sort": sort,
        })
    return json.dumps(out)


def resolve(i):
    """Documentation for completion ``i`` of the most recent ``complete`` call."""
    items = _last["items"]
    if 0 <= i < len(items):
        c = items[i]
        sigs = ""
        try:
            if c.type in ("function", "class"):
                s = c.get_signatures()
                if s:
                    sigs = s[0].to_string()
        except Exception:  # noqa: BLE001
            pass
        return json.dumps({"signature": sigs, "doc": _doc(c)})
    return json.dumps({"signature": "", "doc": ""})


def hover(code, line, column):
    script = _script(code)
    names = script.help(line, column)
    if not names:
        return json.dumps(None)
    n = names[0]
    sig = ""
    try:
        if n.type in ("function", "class"):
            s = n.get_signatures()
            if s:
                sig = s[0].to_string()
    except Exception:  # noqa: BLE001
        pass
    return json.dumps({
        "name": n.name,
        "type": n.type,
        "fullName": n.full_name,
        "description": n.description,
        "signature": sig,
        "doc": _doc(n),
        "line": line,
    })


def signature(code, line, column):
    script = _script(code)
    sigs = script.get_signatures(line, column)
    out = []
    for s in sigs:
        out.append({
            "label": s.to_string(),
            "doc": _doc(s),
            "activeParameter": s.index if s.index is not None else 0,
            "params": [p.to_string().replace("param ", "", 1) for p in s.params],
        })
    return json.dumps(out)


def definition(code, line, column):
    script = _script(code)
    out = []
    for d in script.goto(line, column, follow_imports=False):
        if str(d.module_path) != SCRIPT_PATH or d.line is None:
            continue
        out.append({
            "startLine": d.line,
            "startColumn": d.column + 1,
            "endLine": d.line,
            "endColumn": d.column + 1 + len(d.name),
        })
    return json.dumps(out)
