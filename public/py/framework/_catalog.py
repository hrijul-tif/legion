"""Catalog-backed lazy modules (framework.<mission>.commands / .parameters).

The run worker writes the catalog JSON (public/catalog/<mission>.json) to CATALOG_DIR/<mission>.json
in the Pyodide filesystem. Classes are generated with type() on first attribute access and cached;
enums are real enum.Enum subclasses with the catalog's member names/values.
"""
import difflib
import enum
import json
import os

CATALOG_DIR = '/catalog'

_catalogs = {}


class FieldSpec(object):
    __slots__ = ('name', 'wire', 'type', 'enum_name', 'enum_cls', 'required', 'default', 'has_default', 'description')

    def __init__(self, name, wire, type, enum_name=None, enum_cls=None, required=False,
                 default=None, has_default=False, description=None):
        self.name = name
        self.wire = wire
        self.type = type
        self.enum_name = enum_name
        self.enum_cls = enum_cls
        self.required = required
        self.default = default
        self.has_default = has_default
        self.description = description

    def __repr__(self):
        return 'FieldSpec(%s: %s%s)' % (self.name, self.type, '' if self.required else ' = %r' % (self.default,))


def _make_enum(name, members):
    pairs = []
    seen = set()
    for m in members:
        n = str(m['name'])
        if n in seen:
            continue
        seen.add(n)
        pairs.append((n, m['value']))
    try:
        cls = enum.Enum(name, pairs)
    except (ValueError, TypeError):
        # a member name clashed with an Enum internal (e.g. "mro"): suffix it
        pairs = [((n + '_') if n in ('mro', 'name', 'value') or n.startswith('_') else n, v) for n, v in pairs]
        cls = enum.Enum(name, pairs)
    cls.__module__ = 'framework.catalog'
    return cls


class MissionCatalog(object):
    def __init__(self, mission, data, path):
        self.mission = mission
        self.data = data
        self.path = path
        try:
            self.mtime = os.stat(path).st_mtime
        except OSError:
            self.mtime = 0
        self.cmd_defs = data.get('commands', {})
        self.param_defs = data.get('parameters', {})
        self._enums = {'enums': {}, 'paramEnums': {}}
        self._classes = {'commands': {}, 'parameters': {}}
        self._q_cmd = None
        self._q_param = None

    # ---- enums -------------------------------------------------------------------------------
    def enum_names(self, scope):
        return list(self.data.get(scope, {}).keys())

    def get_enum(self, name, scope):
        cache = self._enums[scope]
        if name in cache:
            return cache[name]
        defs = self.data.get(scope, {})
        if name not in defs:
            return None
        cls = _make_enum(name, defs[name]['members'])
        cache[name] = cls
        return cls

    def enum_members(self, name, scope=None):
        for sc in ([scope] if scope else ['enums', 'paramEnums']):
            d = self.data.get(sc, {}).get(name)
            if d:
                return d['members']
        return None

    # ---- lookups by qualified name ---------------------------------------------------------
    def command_info(self, q):
        if self._q_cmd is None:
            self._q_cmd = {d['q']: k for k, d in self.cmd_defs.items()}
        key = self._q_cmd.get(q)
        if key is None:
            return None
        d = dict(self.cmd_defs[key])
        d['key'] = key
        return d

    def param_info(self, q):
        if self._q_param is None:
            self._q_param = {d['q']: k for k, d in self.param_defs.items()}
        key = self._q_param.get(q)
        if key is None:
            return None
        d = dict(self.param_defs[key])
        d['key'] = key
        return d

    def resolve_param_q(self, name):
        """Accept a qualified name or a generated class name; returns the qualified name."""
        if name.startswith('/'):
            return name
        d = self.param_defs.get(name)
        return d['q'] if d else name

    # ---- classes -------------------------------------------------------------------------------
    def get_class(self, kind, name):
        cache = self._classes[kind]
        cls = cache.get(name)
        if cls is not None:
            return cls
        if kind == 'commands':
            defs = self.cmd_defs
        else:
            defs = self.param_defs
        d = defs.get(name)
        if d is None:
            return None
        from framework.mdb.super_class import SuperCommand, SuperParameter
        if kind == 'commands':
            cls = self._build_command(name, d, SuperCommand)
        else:
            cls = self._build_parameter(name, d, SuperParameter)
        cache[name] = cls
        return cls

    def _enum_for(self, enum_name, primary):
        if not enum_name:
            return None
        other = 'paramEnums' if primary == 'enums' else 'enums'
        return self.get_enum(enum_name, primary) or self.get_enum(enum_name, other)

    def _build_command(self, name, d, base):
        fields = []
        for a in d.get('args', []):
            fields.append(FieldSpec(
                a['name'], a.get('wire', a['name']), a.get('type', 'any'), a.get('enum'),
                self._enum_for(a.get('enum'), 'enums'), bool(a.get('required')),
                a.get('default'), 'default' in a, a.get('description')))
        ns = {
            '_fields_': fields,
            '_fixed_': dict(d.get('fixed', {})),
            '_subsystem_': d.get('subsystem'),
            'field_qualified_name_': d['q'],
            '__doc__': d.get('description') or '',
            '__module__': 'framework.%s.commands' % self.mission.lower(),
        }
        for k, v in d.get('fixed', {}).items():
            ns['field_' + k] = v
        return type(name, (base,), ns)

    def _build_parameter(self, name, d, base):
        fld = d.get('field') or name
        spec = FieldSpec(fld, fld, d.get('type', 'any'), d.get('enum'),
                         self._enum_for(d.get('enum'), 'paramEnums'), False, None, True, d.get('description'))
        ns = {
            '_fields_': [spec],
            '_fixed_': {},
            '_subsystem_': d.get('subsystem'),
            'field_qualified_name_': d['q'],
            'field_argument_type_': d.get('kind', 'normal'),
            '__doc__': d.get('description') or '',
            '__module__': 'framework.%s.parameters' % self.mission.lower(),
        }
        return type(name, (base,), ns)


def get(mission):
    """Load (and cache) the catalog of a mission from the Pyodide filesystem; None if absent."""
    path = '%s/%s.json' % (CATALOG_DIR, mission.lower())
    cached = _catalogs.get(mission)
    try:
        mtime = os.stat(path).st_mtime
    except OSError:
        return None
    if cached is not None and cached.mtime == mtime:
        return cached
    with open(path, 'r') as fh:
        data = json.load(fh)
    cat = MissionCatalog(mission, data, path)
    _catalogs[mission] = cat
    return cat


def reset():
    _catalogs.clear()


class LazyModule(object):
    """Implements PEP 562 `__getattr__` / `__dir__` for framework.<mission>.<commands|parameters>."""

    def __init__(self, mission, kind, module_name):
        self.mission = mission
        self.kind = kind          # 'commands' | 'parameters'
        self.module_name = module_name
        self.enum_scope = 'enums' if kind == 'commands' else 'paramEnums'

    def _catalog(self):
        cat = get(self.mission)
        if cat is None:
            raise AttributeError('module %r: no %s catalog loaded (%s/%s.json is missing)' % (
                self.module_name, self.mission, CATALOG_DIR, self.mission.lower()))
        return cat

    def names(self):
        cat = self._catalog()
        defs = cat.cmd_defs if self.kind == 'commands' else cat.param_defs
        return sorted(list(cat.enum_names(self.enum_scope)) + list(defs.keys()))

    def getattr(self, name):
        if name.startswith('__') and name.endswith('__'):
            if name == '__all__':
                return self.names()
            raise AttributeError(name)
        cat = self._catalog()
        e = cat.get_enum(name, self.enum_scope)
        if e is not None:
            return e
        c = cat.get_class(self.kind, name)
        if c is not None:
            return c
        hint = difflib.get_close_matches(name, self.names(), n=3, cutoff=0.6)
        msg = "module %r has no attribute %r" % (self.module_name, name)
        if hint:
            msg += ". Did you mean: %s?" % ', '.join(hint)
        raise AttributeError(msg)

    def dir(self):
        try:
            return self.names()
        except AttributeError:
            return []
