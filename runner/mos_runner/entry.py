"""Entrypoint discovery (same rules as the in-browser mock; copied from public/py/mos_sim/procedure_info.py)."""
import ast


def public_functions(tree):
    return [n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and not n.name.startswith('_')]


def pick_entrypoint(tree, requested=None):
    """Returns (function_node | None, candidate_names, error | None)."""
    funcs = public_functions(tree)
    names = [f.name for f in funcs]
    if requested:
        for f in funcs:
            if f.name == requested:
                return f, names, None
        # allow private / nested-looking names too
        for n in tree.body:
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == requested:
                return n, names, None
        return None, names, 'Entrypoint %r not found in the procedure (functions: %s)' % (requested, ', '.join(names) or 'none')
    if len(funcs) == 1:
        return funcs[0], names, None
    if not funcs:
        return None, names, 'The procedure defines no public top-level function'
    suffixed = [f for f in funcs if f.name.endswith('_Procedure') or f.name.endswith('Procedure')]
    if len(suffixed) == 1:
        return suffixed[0], names, None
    return None, names, 'The procedure has several public functions (%s); pick an entrypoint' % ', '.join(names)
