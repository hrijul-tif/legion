"""Prints the stored `signature` JSON of a JTYU procedure ({entrypoint, params[]}) using the MOS checker and the catalog.
Usage: python3 signature.py <procedure.py> <public/catalog/jtyu.json> <public/py>   (stdlib only, Python >= 3.9)"""
import json
import os
import sys

sys.dont_write_bytecode = True
code_path, catalog_path, py_dir = sys.argv[1:4]
sys.path.insert(0, py_dir)
from mos_lint import mos_check  # noqa: E402

cat = json.load(open(catalog_path))
code = open(code_path).read()
res = mos_check(code, "JTYU", {"commands": list(cat["enums"]), "parameters": list(cat["paramEnums"])})
errors = [d for d in res["diagnostics"] if d["severity"] == "error"]
if errors:
    sys.exit("MOS checker errors in %s: %s" % (os.path.basename(code_path), "; ".join("%s line %s: %s" % (d["code"], d["startLine"], d["message"]) for d in errors)))
params = []
for p in res["entry"]["params"]:
    out = {"name": p["name"], "annotation": p.get("annotation") or "", "kind": p["kind"], "required": bool(p["required"]), "optional": False}
    if p.get("enum"):
        out["enum"] = p["enum"]
        table = cat["enums"] if p.get("enumModule") != "parameters" else cat["paramEnums"]
        if p["enum"] in table:
            out["members"] = table[p["enum"]]["members"]
    if "default" in p:
        out["default"] = p["default"]
    params.append(out)
print(json.dumps({"entrypoint": res["entry"]["entrypoint"], "params": params, "doc": res["entry"].get("doc", "")}))
