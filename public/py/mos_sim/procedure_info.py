"""Static analysis of a procedure file (no execution): entrypoint discovery + signature."""
import ast
import json

_LIST_NAMES = ('list', 'List', 'Sequence', 'tuple', 'Tuple', 'set', 'Set', 'Iterable')


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


def _unwrap_optional(node):
    """Returns (inner_node, optional)."""
    if isinstance(node, ast.Subscript):
        base = ast.unparse(node.value).split('.')[-1]
        sl = node.slice
        if base == 'Optional':
            return sl, True
        if base == 'Union':
            elts = sl.elts if isinstance(sl, ast.Tuple) else [sl]
            rest = [e for e in elts if not (isinstance(e, ast.Constant) and e.value is None)]
            if len(rest) == 1 and len(rest) != len(elts):
                return rest[0], True
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.BitOr):
        left, right = node.left, node.right
        if isinstance(right, ast.Constant) and right.value is None:
            return left, True
        if isinstance(left, ast.Constant) and left.value is None:
            return right, True
    return node, False


def classify(node, catalog):
    """Returns (kind, enum_name | None, optional)."""
    if node is None:
        return 'any', None, False
    node, optional = _unwrap_optional(node)
    src = ast.unparse(node)
    last = src.split('.')[-1]
    if isinstance(node, ast.Subscript):
        base = ast.unparse(node.value).split('.')[-1]
        if base in _LIST_NAMES:
            return 'list', None, optional
        return 'any', None, optional
    if last in ('str',):
        return 'str', None, optional
    if last == 'int':
        return 'int', None, optional
    if last == 'float':
        return 'float', None, optional
    if last == 'bool':
        return 'bool', None, optional
    if last in _LIST_NAMES:
        return 'list', None, optional
    if last in ('datetime',):
        return 'datetime', None, optional
    if isinstance(node, (ast.Name, ast.Attribute)):
        if catalog is not None and (last in catalog.data.get('enums', {}) or last in catalog.data.get('paramEnums', {})):
            return 'enum', last, optional
        if last.endswith('Enum'):
            return 'enum', last, optional
    return 'any', None, optional


def signature_of(fn, catalog):
    a = fn.args
    params = []
    pos = list(getattr(a, 'posonlyargs', [])) + list(a.args)
    defaults = [None] * (len(pos) - len(a.defaults)) + list(a.defaults)
    entries = list(zip(pos, defaults)) + list(zip(a.kwonlyargs, a.kw_defaults))
    for arg, default in entries:
        kind, enum_name, optional = classify(arg.annotation, catalog)
        p = {
            'name': arg.arg,
            'annotation': ast.unparse(arg.annotation) if arg.annotation is not None else None,
            'kind': kind,
            'required': default is None,
            'optional': optional,
        }
        if enum_name:
            p['enum'] = enum_name
            members = catalog.enum_members(enum_name) if catalog is not None else None
            if members:
                p['members'] = members
        if default is not None:
            try:
                p['default'] = ast.literal_eval(default)
            except Exception:
                p['defaultExpr'] = ast.unparse(default)
        params.append(p)
    return params


def inspect_code(code, mission='FF', requested=None):
    from framework import _catalog
    result = {'type': 'signature', 'entrypoint': None, 'params': [], 'candidates': []}
    try:
        tree = ast.parse(code)
    except SyntaxError as exc:
        result['error'] = 'SyntaxError: %s (line %s)' % (exc.msg, exc.lineno)
        return result
    fn, names, err = pick_entrypoint(tree, requested)
    result['candidates'] = names
    if fn is None:
        result['error'] = err
        return result
    result['entrypoint'] = fn.name
    result['params'] = signature_of(fn, _catalog.get(mission))
    return result


def inspect_json(code, mission='FF', requested=None):
    return json.dumps(inspect_code(code, mission, requested), default=str)
