"""Static pre-flight for procedure source. Defence in depth for a prototype that executes operator-supplied
Python on the developer's machine; it is NOT a sandbox. Mirrors the module allowlist of the in-browser sandbox."""
import ast

ALLOWED_STDLIB = {
    "__future__", "operator", "time", "datetime", "math", "re", "json", "enum", "typing", "dataclasses", "collections",
    "itertools", "functools", "statistics", "random", "string", "textwrap", "copy", "decimal", "fractions", "logging",
    "typing_extensions",
}
ALLOWED_FRAMEWORK = (
    "framework.jtyu.commands", "framework.jtyu.parameters", "framework.mdb.super_class", "framework.utils.log_helper",
    "framework.utils.custom_exceptions", "framework.utils.commanding", "framework.settings",
)
ALLOWED_PREFIX_PARENTS = {"framework", "framework.jtyu", "framework.mdb", "framework.utils"}
FORBIDDEN_CALLS = {"open", "exec", "eval", "compile", "__import__", "breakpoint", "input", "globals", "locals", "vars"}


def _module_ok(name):
    top = name.split(".")[0]
    if top in ALLOWED_STDLIB:
        return True
    if top == "framework":
        return name in ALLOWED_PREFIX_PARENTS or any(name == m or name.startswith(m + ".") for m in ALLOWED_FRAMEWORK)
    return False


def check(tree):
    """Returns an error string or None."""
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                if not _module_ok(a.name):
                    return "line %d: import of %r is not allowed in a MOS procedure" % (node.lineno, a.name)
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                return "line %d: relative imports are not allowed" % node.lineno
            mod = node.module or ""
            if not _module_ok(mod):
                return "line %d: import from %r is not allowed in a MOS procedure" % (node.lineno, mod)
            if mod in ALLOWED_PREFIX_PARENTS:
                for a in node.names:
                    if not _module_ok(mod + "." + a.name):
                        return "line %d: import of %r is not allowed in a MOS procedure" % (node.lineno, mod + "." + a.name)
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in FORBIDDEN_CALLS:
            return "line %d: call to %s() is not allowed in a MOS procedure" % (node.lineno, node.func.id)
    return None
