#!/usr/bin/env python3
"""Build public/catalog/<mission>.json from the generated mos-framework TM/TC modules.

Usage:
    python3 scripts/build_catalog.py [--framework PATH] [--mission ff|jtyu] [--out FILE]

Parses framework/<mission>/commands.py and parameters.py with `ast` (nothing is imported or
executed). Output shape is the `Catalog` type in lib/catalog/types.ts. Python 3.9, stdlib only.
"""
import argparse
import ast
import json
import os
import re
import subprocess
import sys

DEFAULT_FRAMEWORK = "/Users/hrijul.bhatnagar/Files/Code/mos-framework"
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

NO_DESC = {"No description available.", "Enum - No description available."}
PRE_ASSIGNED = "Pre-assigned Argument"
SCALARS = {"str": "str", "int": "int", "float": "float", "bool": "bool"}


def clean_description(text):
    if not isinstance(text, str):
        return None
    text = text.strip()
    if not text or text in NO_DESC:
        return None
    if text.startswith("Enum - "):
        text = text[len("Enum - "):].strip()
    if not text or text in NO_DESC:
        return None
    return text


def base_names(cls):
    out = []
    for b in cls.bases:
        out.append(b.id if isinstance(b, ast.Name) else ast.unparse(b))
    return out


def strip_optional(ann):
    """Optional[X] -> X (as a string), otherwise unchanged."""
    m = re.fullmatch(r"(?:typing\.)?Optional\[(.*)\]", ann.strip())
    return m.group(1).strip() if m else ann.strip()


def map_type(ann, enum_names):
    """Return (type, enum_or_None) for an annotation string."""
    inner = strip_optional(ann)
    if inner in SCALARS:
        return SCALARS[inner], None
    if inner in ("AwareDatetime", "datetime", "datetime.datetime"):
        return "datetime", None
    if inner in enum_names:
        return "enum", inner
    if re.match(r"(?:typing\.)?[Ll]ist\b", inner):
        return "list", None
    return "any", None


def field_call(value):
    """Return (default_node, {kw: node}) for `Field(default, k=v...)`, else (value, {})."""
    if isinstance(value, ast.Call) and getattr(value.func, "id", getattr(value.func, "attr", None)) == "Field":
        default = value.args[0] if value.args else None
        kws = {k.arg: k.value for k in value.keywords if k.arg}
        if default is None and "default" in kws:
            default = kws.pop("default")
        return default, kws
    return value, {}


def lit(node):
    """literal_eval that returns (ok, value); Ellipsis counts as ok with value ...."""
    if node is None:
        return False, None
    if isinstance(node, ast.Constant) and node.value is Ellipsis:
        return True, Ellipsis
    try:
        return True, ast.literal_eval(node)
    except Exception:
        return False, None


def json_extra(kws):
    node = kws.get("json_schema_extra")
    ok, val = lit(node)
    return val if ok and isinstance(val, dict) else {}


def parse_enums(tree):
    enums = {}
    for node in tree.body:
        if isinstance(node, ast.ClassDef) and "Enum" in base_names(node):
            members = []
            for s in node.body:
                if isinstance(s, ast.Assign) and len(s.targets) == 1 and isinstance(s.targets[0], ast.Name):
                    ok, v = lit(s.value)
                    if ok and isinstance(v, (str, int, float)) and not isinstance(v, bool):
                        members.append({"name": s.targets[0].id, "value": v})
            enums[node.name] = {"members": members}
    return enums


def subsystem_of(q):
    parts = [p for p in q.split("/") if p]
    # /FF/<Subsystem>/<Name>; names directly under the mission (packet headers, ground-station
    # telemetry) have no subsystem of their own, so group them instead of making each its own facet.
    return parts[1] if len(parts) > 2 else "Common"


def simple_default(v):
    if v is None or isinstance(v, (str, int, float, bool)):
        return True
    return False


def parse_commands(tree, enum_names):
    commands = {}
    for node in tree.body:
        if not (isinstance(node, ast.ClassDef) and "SuperCommand" in base_names(node)):
            continue
        if node.name == "Model":
            continue
        q = None
        args = []
        fixed = {}
        for s in node.body:
            if not (isinstance(s, ast.AnnAssign) and isinstance(s.target, ast.Name)):
                continue
            name = s.target.id
            default_node, kws = field_call(s.value)
            ok_d, default = lit(default_node)
            ok_desc, desc = lit(kws.get("description"))
            desc = desc if ok_desc else None
            if name == "field_qualified_name_":
                q = default if ok_d and isinstance(default, str) else None
                continue
            if name in ("field_base_command_", "field_argument_type_"):
                continue
            ok_t, title = lit(kws.get("title"))
            title = title.strip() if ok_t and isinstance(title, str) else None
            ok_a, alias = lit(kws.get("alias"))
            if name.startswith("field_") and isinstance(desc, str) and desc.startswith(PRE_ASSIGNED):
                key = title or (alias.lstrip("_") if ok_a and isinstance(alias, str) else name[len("field_"):])
                if ok_d and default is not Ellipsis:
                    fixed[key] = str(default)
                continue
            ann = ast.unparse(s.annotation)
            typ, enum = map_type(ann, enum_names)
            extra = json_extra(kws)
            wire = extra.get("actual_name") or title or name
            arg = {
                "name": name,
                "wire": wire,
                "type": typ,
                "required": ok_d and default is Ellipsis,
            }
            if enum:
                arg["enum"] = enum
            if ok_d and default is not Ellipsis and simple_default(default):
                if isinstance(default, str) and typ in ("int", "float"):
                    try:
                        default = int(default) if typ == "int" else float(default)
                    except ValueError:
                        pass
                arg["default"] = default
            d = clean_description(desc)
            if d:
                arg["description"] = d
            args.append(arg)
        if not q:
            print("warning: command %s has no qualified name; skipped" % node.name, file=sys.stderr)
            continue
        cmd = {"q": q, "subsystem": subsystem_of(q)}
        doc = clean_description(ast.get_docstring(node))
        if doc:
            cmd["description"] = doc
        cmd["args"] = args
        cmd["fixed"] = fixed
        commands[node.name] = cmd
    return commands


PARAM_TYPES = {"float", "int", "str", "bool", "enum", "any"}


def parse_parameters(tree, enum_names):
    params = {}
    for node in tree.body:
        if not (isinstance(node, ast.ClassDef) and "SuperParameter" in base_names(node)):
            continue
        if node.name == "Model":
            continue
        q = None
        kind = "normal"
        values = []
        for s in node.body:
            if not (isinstance(s, ast.AnnAssign) and isinstance(s.target, ast.Name)):
                continue
            name = s.target.id
            default_node, kws = field_call(s.value)
            ok_d, default = lit(default_node)
            if name == "field_qualified_name_":
                q = default if ok_d and isinstance(default, str) else None
            elif name == "field_argument_type_":
                if ok_d and default in ("normal", "enumeration", "aggregate"):
                    kind = default
            elif name.startswith("field_") and name != "field_":
                ok_desc, desc = lit(kws.get("description"))
                if ok_desc and isinstance(desc, str) and desc.startswith(PRE_ASSIGNED):
                    continue
                values.append((name, s, kws))
            else:
                values.append((name, s, kws))
        if not q:
            print("warning: parameter %s has no qualified name; skipped" % node.name, file=sys.stderr)
            continue
        p = {"q": q, "subsystem": subsystem_of(q)}
        if len(values) == 1:
            name, s, kws = values[0]
            typ, enum = map_type(ast.unparse(s.annotation), enum_names)
            ok_desc, desc = lit(kws.get("description"))
            p["kind"] = kind
            p["field"] = name
            p["type"] = typ if typ in PARAM_TYPES else "any"
            if enum:
                p["enum"] = enum
            d = clean_description(desc if ok_desc else None)
            if d:
                p["description"] = d
        else:
            p["kind"] = "aggregate"
            p["field"] = values[0][0] if values else ""
            p["type"] = "any"
        params[node.name] = p
    return params


def header_timestamp(path):
    with open(path, "r", encoding="utf-8") as f:
        for _ in range(8):
            m = re.match(r"#\s*timestamp:\s*(\S+)", f.readline())
            if m:
                return m.group(1)
    return None


def git_sha(root):
    try:
        out = subprocess.run(
            ["git", "-C", root, "rev-parse", "--short", "HEAD"],
            capture_output=True, text=True, timeout=10,
        )
        return out.stdout.strip() if out.returncode == 0 else ""
    except Exception:
        return ""


def parse_file(path):
    with open(path, "r", encoding="utf-8") as f:
        return ast.parse(f.read(), filename=path)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--framework", default=DEFAULT_FRAMEWORK, help="path to the mos-framework checkout")
    ap.add_argument("--mission", default="ff", choices=["ff", "jtyu"])
    ap.add_argument("--out", default=None, help="output file (default public/catalog/<mission>.json)")
    ns = ap.parse_args()

    root = os.path.abspath(os.path.expanduser(ns.framework))
    pkg = os.path.join(root, "framework", ns.mission)
    cmd_path = os.path.join(pkg, "commands.py")
    par_path = os.path.join(pkg, "parameters.py")
    for p in (cmd_path, par_path):
        if not os.path.isfile(p):
            sys.exit("error: not found: %s" % p)
    out_path = ns.out or os.path.join(REPO_ROOT, "public", "catalog", ns.mission + ".json")

    cmd_tree = parse_file(cmd_path)
    par_tree = parse_file(par_path)
    enums = parse_enums(cmd_tree)
    param_enums = parse_enums(par_tree)
    commands = parse_commands(cmd_tree, set(enums))
    parameters = parse_parameters(par_tree, set(param_enums))

    ts = header_timestamp(cmd_path) or header_timestamp(par_path) or ""
    sha = git_sha(root)
    source = "mos-framework"
    if sha:
        source += " @ " + sha
    if ts:
        source += " (generated %s)" % ts[:10]

    catalog = {
        "mission": ns.mission.upper(),
        "source": source,
        "generatedAt": ts,
        "enums": enums,
        "paramEnums": param_enums,
        "commands": commands,
        "parameters": parameters,
    }
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(catalog, f, separators=(",", ":"), ensure_ascii=False)
    size = os.path.getsize(out_path)
    print("mission     : %s" % catalog["mission"])
    print("source      : %s" % source)
    print("commands    : %d" % len(commands))
    print("parameters  : %d" % len(parameters))
    print("enums       : %d (commands) / %d (parameters)" % (len(enums), len(param_enums)))
    print("output      : %s (%.1f KB)" % (out_path, size / 1024.0))


if __name__ == "__main__":
    main()
