// Pure (monaco-free) analysis of a procedure's source against a Catalog:
// import-alias detection, expression resolution, completion / hover / signature contexts and diagnostics.
// All positions are 0-based string offsets unless a *Range field says otherwise.

import type { Catalog, CatalogArg, CatalogCommand } from '../catalog/types';
import { closestNames } from '../catalog/similar';
import {
  argCard,
  argSummary,
  argTypeLabel,
  commandCard,
  enumCard,
  enumMemberCard,
  enumsFor,
  formatValue,
  parameterCard,
  type ModuleKind,
} from './catalog-docs';
import {
  COMMAND_METHODS,
  COMMAND_METHOD_MAP,
  PARAMETER_METHODS,
  PARAMETER_METHOD_MAP,
  methodMarkdown,
  methodSignature,
  paramLabel,
  type MethodSpec,
} from './mos-methods';
import { tokenize, type Tok, type Tokenized } from './python-tokens';

export type Mission = Catalog['mission'];
export type Kind = ModuleKind;

// ---------------------------------------------------------------------------------------------
// Aliases

export interface AliasInfo {
  kind: Kind;
  mission: Mission;
}

export interface ImportedName {
  kind: Kind;
  mission: Mission;
  /** class name in the generated module */
  name: string;
}

const MISSIONS: Record<string, Mission> = { ff: 'FF', jtyu: 'JTYU' };
const MODULE_PATH = /^framework\.(ff|jtyu)\.(commands|parameters)$/;

/** Module aliases declared in `source` (plus the always-valid fully-qualified names). */
export function detectAliases(source: string): Map<string, AliasInfo> {
  const out = new Map<string, AliasInfo>();
  for (const mission of Object.values(MISSIONS)) {
    for (const kind of ['commands', 'parameters'] as Kind[]) {
      out.set(`framework.${mission.toLowerCase()}.${kind}`, { kind, mission });
    }
  }
  const stripComment = (s: string) => s.replace(/#.*$/gm, '');

  // import framework.ff.commands as comm[, framework.ff.parameters as param]
  const importRe = /^[ \t]*import[ \t]+([^\n]+)/gm;
  for (let m = importRe.exec(source); m; m = importRe.exec(source)) {
    for (const part of stripComment(m[1]).split(',')) {
      const mm = /^\s*([\w.]+)(?:\s+as\s+(\w+))?\s*$/.exec(part);
      if (!mm) continue;
      const pm = MODULE_PATH.exec(mm[1]);
      if (!pm) continue;
      out.set(mm[2] ?? mm[1], { kind: pm[2] as Kind, mission: MISSIONS[pm[1]] });
    }
  }

  // from framework.ff import commands as comm, parameters as param
  const fromRe = /^[ \t]*from[ \t]+framework\.(ff|jtyu)[ \t]+import[ \t]+(\([^)]*\)|[^\n]+)/gm;
  for (let m = fromRe.exec(source); m; m = fromRe.exec(source)) {
    const body = stripComment(m[2]).replace(/[()]/g, '');
    for (const part of body.split(',')) {
      const mm = /^\s*(commands|parameters)(?:\s+as\s+(\w+))?\s*$/.exec(part);
      if (!mm) continue;
      out.set(mm[2] ?? mm[1], { kind: mm[1] as Kind, mission: MISSIONS[m[1]] });
    }
  }
  return out;
}

/** `from framework.ff.commands import EPSFoo as Foo` style imports. */
export function detectImportedNames(source: string): Map<string, ImportedName> {
  const out = new Map<string, ImportedName>();
  const re = /^[ \t]*from[ \t]+framework\.(ff|jtyu)\.(commands|parameters)[ \t]+import[ \t]+(\([^)]*\)|[^\n]+)/gm;
  for (let m = re.exec(source); m; m = re.exec(source)) {
    const body = m[3].replace(/#.*$/gm, '').replace(/[()]/g, '');
    for (const part of body.split(',')) {
      const mm = /^\s*(\w+)(?:\s+as\s+(\w+))?\s*$/.exec(part);
      if (!mm || mm[1] === '*') continue;
      out.set(mm[2] ?? mm[1], { kind: m[2] as Kind, mission: MISSIONS[m[1]], name: mm[1] });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Analysis

interface Assignment {
  name: string;
  idx: number;
  rhsStart: number;
  rhsEnd: number;
}

export interface Analysis extends Tokenized {
  source: string;
  catalog: Catalog;
  /** aliases usable with this catalog's mission */
  aliases: Map<string, AliasInfo>;
  imported: Map<string, ImportedName>;
  /** `framework`, `framework.ff`, ... that lead to a module */
  pkgPaths: Set<string>;
  assignments: Assignment[];
  lineStarts: number[];
}

export function analyze(source: string, catalog: Catalog): Analysis {
  const tk = tokenize(source);
  const aliasesAll = detectAliases(source);
  const aliases = new Map<string, AliasInfo>();
  for (const [k, v] of aliasesAll) if (v.mission === catalog.mission) aliases.set(k, v);
  const imported = new Map<string, ImportedName>();
  for (const [k, v] of detectImportedNames(source)) if (v.mission === catalog.mission) imported.set(k, v);
  const mlow = catalog.mission.toLowerCase();
  const pkgPaths = new Set<string>(['framework', `framework.${mlow}`]);

  const { tokens, enclosing } = tk;
  const assignments: Assignment[] = [];
  const n = tokens.length;
  for (let i = 0; i + 2 < n; i++) {
    const t = tokens[i];
    if (t.t !== 'name' || !t.nl || tokens[i + 1].t !== 'op' || tokens[i + 1].s !== '=') continue;
    let end = i + 2;
    while (end + 1 < n && !(tokens[end + 1].nl && enclosing[end + 1] === enclosing[i])) end++;
    assignments.push({ name: t.s, idx: i, rhsStart: i + 2, rhsEnd: end });
  }

  const lineStarts = [0];
  for (let i = 0; i < source.length; i++) if (source.charCodeAt(i) === 10) lineStarts.push(i + 1);

  return { ...tk, source, catalog, aliases, imported, pkgPaths, assignments, lineStarts };
}

export function offsetToPos(a: Analysis, offset: number): { line: number; column: number } {
  const ls = a.lineStarts;
  let lo = 0;
  let hi = ls.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ls[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: offset - ls[lo] + 1 };
}

// ---------------------------------------------------------------------------------------------
// Expression resolution

export type Ref =
  | { t: 'unknown' }
  | { t: 'pkg'; path: string }
  | { t: 'module'; kind: Kind }
  | { t: 'class'; kind: Kind; name: string; enum: boolean }
  | { t: 'missing'; kind: Kind; name: string }
  | { t: 'instance'; kind: Kind; name: string }
  | { t: 'enumMember'; kind: Kind; enum: string; member: string }
  | { t: 'badMember'; kind: Kind; enum: string; member: string }
  | { t: 'method'; owner: Kind; name: string };

const UNKNOWN: Ref = { t: 'unknown' };

/** Names that exist in the generated modules but are not catalog entries. */
const MODULE_PASSTHROUGH = new Set([
  'SuperCommand',
  'SuperParameter',
  'Model',
  'Enum',
  'Any',
  'Optional',
  'ConfigDict',
  'Field',
  'AwareDatetime',
  'Literal',
  'annotations',
]);
const ENUM_ATTRS = new Set(['name', 'value', '_name_', '_value_', '_member_map_', '_value2member_map_', '_member_names_']);

function isOp(t: Tok | undefined, s: string): boolean {
  return !!t && t.t === 'op' && t.s === s;
}

export function classKnown(catalog: Catalog, kind: Kind, name: string): 'class' | 'enum' | null {
  if (kind === 'commands') {
    if (Object.hasOwn(catalog.commands, name)) return 'class';
  } else if (Object.hasOwn(catalog.parameters, name)) return 'class';
  if (Object.hasOwn(enumsFor(catalog, kind), name)) return 'enum';
  return null;
}

function attrOf(a: Analysis, recv: Ref, name: string): Ref {
  switch (recv.t) {
    case 'pkg': {
      const path = `${recv.path}.${name}`;
      const m = MODULE_PATH.exec(path);
      if (m && a.aliases.has(path)) return { t: 'module', kind: m[2] as Kind };
      if (a.pkgPaths.has(path)) return { t: 'pkg', path };
      return UNKNOWN;
    }
    case 'module': {
      const k = classKnown(a.catalog, recv.kind, name);
      if (k) return { t: 'class', kind: recv.kind, name, enum: k === 'enum' };
      if (MODULE_PASSTHROUGH.has(name) || name.startsWith('__')) return UNKNOWN;
      return { t: 'missing', kind: recv.kind, name };
    }
    case 'class': {
      if (!recv.enum) return UNKNOWN;
      const e = enumsFor(a.catalog, recv.kind)[recv.name];
      if (!e) return UNKNOWN;
      if (e.members.some((m) => m.name === name)) return { t: 'enumMember', kind: recv.kind, enum: recv.name, member: name };
      if (ENUM_ATTRS.has(name) || name.startsWith('__')) return UNKNOWN;
      return { t: 'badMember', kind: recv.kind, enum: recv.name, member: name };
    }
    case 'instance': {
      const map = recv.kind === 'commands' ? COMMAND_METHOD_MAP : PARAMETER_METHOD_MAP;
      return map.has(name) ? { t: 'method', owner: recv.kind, name } : UNKNOWN;
    }
    default:
      return UNKNOWN;
  }
}

function baseName(a: Analysis, name: string, idx: number, depth: number): Ref {
  const al = a.aliases.get(name);
  if (al) return { t: 'module', kind: al.kind };
  const imp = a.imported.get(name);
  if (imp) {
    const k = classKnown(a.catalog, imp.kind, imp.name);
    if (k) return { t: 'class', kind: imp.kind, name: imp.name, enum: k === 'enum' };
  }
  if (name === 'framework') return { t: 'pkg', path: 'framework' };
  // last simple assignment before this use
  for (let i = a.assignments.length - 1; i >= 0; i--) {
    const asg = a.assignments[i];
    if (asg.name !== name || asg.idx >= idx) continue;
    if (idx >= asg.rhsStart && idx <= asg.rhsEnd) continue; // use inside its own RHS
    return resolveExpr(a, asg.rhsEnd, depth + 1);
  }
  return UNKNOWN;
}

/** Resolve the expression whose last token is tokens[idx]. */
export function resolveExpr(a: Analysis, idx: number, depth = 0): Ref {
  if (idx < 0 || idx >= a.tokens.length || depth > 24) return UNKNOWN;
  const tk = a.tokens[idx];
  if (isOp(tk, ')')) {
    const o = a.pair[idx];
    return o > 0 ? callResult(a, o, depth + 1) : UNKNOWN;
  }
  if (tk.t !== 'name') return UNKNOWN;
  if (isOp(a.tokens[idx - 1], '.')) {
    if (idx < 2) return UNKNOWN;
    return attrOf(a, resolveExpr(a, idx - 2, depth + 1), tk.s);
  }
  return baseName(a, tk.s, idx, depth);
}

/** Result of calling the thing before the '(' at tokens[o]. */
function callResult(a: Analysis, o: number, depth: number): Ref {
  if (o < 1) return UNKNOWN;
  const f = resolveExpr(a, o - 1, depth);
  if (f.t === 'class' && !f.enum) return { t: 'instance', kind: f.kind, name: f.name };
  return UNKNOWN;
}

/** Alias name to use in generated code for a module kind (prefers a short alias). */
export function aliasFor(a: Analysis, kind: Kind): string {
  let dotted: string | undefined;
  for (const [name, info] of a.aliases) {
    if (info.kind !== kind) continue;
    if (!name.includes('.')) return name;
    dotted = name;
  }
  return dotted ?? `framework.${a.catalog.mission.toLowerCase()}.${kind}`;
}

// ---------------------------------------------------------------------------------------------
// Calls

export interface ArgSpan {
  /** kwarg name token (undefined for positional / star args) */
  nameTok?: Tok;
  nameIdx: number;
  eqIdx: number;
  /** first/last token index of the value expression, -1 when empty */
  valueStart: number;
  valueEnd: number;
  star: boolean;
}

/** Split the argument list of the call opened at tokens[o]. */
export function callArgs(a: Analysis, o: number): { args: ArgSpan[]; closed: boolean; hasStar: boolean } {
  const { tokens, pair, enclosing } = a;
  const close = pair[o];
  const closed = close > o;
  const last = closed ? close : tokens.length;
  const args: ArgSpan[] = [];
  let start = o + 1;
  let hasStar = false;
  const flush = (endExclusive: number) => {
    if (endExclusive <= start) return;
    const first = tokens[start];
    if (first.t === 'op' && (first.s === '*' || first.s === '**')) {
      hasStar = true;
      args.push({ nameIdx: -1, eqIdx: -1, valueStart: start + 1, valueEnd: endExclusive - 1, star: true });
    } else if (first.t === 'name' && isOp(tokens[start + 1], '=') && start + 1 < endExclusive) {
      args.push({
        nameTok: first,
        nameIdx: start,
        eqIdx: start + 1,
        valueStart: start + 2 < endExclusive ? start + 2 : -1,
        valueEnd: start + 2 < endExclusive ? endExclusive - 1 : -1,
        star: false,
      });
    } else if (first.t === 'name' && isOp(tokens[start + 1], '=') && start + 1 >= endExclusive) {
      args.push({ nameTok: first, nameIdx: start, eqIdx: start + 1, valueStart: -1, valueEnd: -1, star: false });
    } else {
      args.push({ nameIdx: -1, eqIdx: -1, valueStart: start, valueEnd: endExclusive - 1, star: false });
    }
  };
  for (let k = o + 1; k < last; k++) {
    if (enclosing[k] === o && isOp(tokens[k], ',')) {
      flush(k);
      start = k + 1;
    }
  }
  flush(last);
  return { args, closed, hasStar };
}

export function findArg(cmd: CatalogCommand, kw: string): CatalogArg | undefined {
  return cmd.args.find((x) => x.name === kw || x.wire === kw || '_' + x.wire === kw);
}

function innermostCallOpener(a: Analysis, offset: number): number {
  // index of last token starting before the cursor
  const { tokens, enclosing } = a;
  let lo = 0;
  let hi = tokens.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (tokens[mid].start < offset) {
      idx = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (idx < 0) return -1;
  const t = tokens[idx];
  let o: number;
  if (t.end > offset) o = enclosing[idx];
  else if (isOp(t, '(') || isOp(t, '[') || isOp(t, '{')) o = idx;
  else o = enclosing[idx];
  while (o >= 0 && !isOp(tokens[o], '(')) o = enclosing[o];
  return o;
}

// ---------------------------------------------------------------------------------------------
// Completions

export interface CompletionSpec {
  label: string;
  insertText: string;
  kind: 'class' | 'enum' | 'member' | 'kwarg' | 'value' | 'method' | 'module';
  detail?: string;
  documentation?: string;
  /** computed on demand (completion lists can be ~2000 items) */
  lazyDocumentation?: () => string;
  sortText: string;
  filterText?: string;
  snippet?: boolean;
  /** re-open the suggest widget after accepting */
  retrigger?: boolean;
  /** replace [start, replaceEnd); the "insert" variant ends at insertEnd */
  start: number;
  insertEnd: number;
  replaceEnd: number;
}

function pad(n: number): string {
  return String(n).padStart(4, '0');
}

function pyQuote(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function matches(label: string, prefixLower: string): boolean {
  return !prefixLower || label.toLowerCase().includes(prefixLower);
}

interface Word {
  start: number;
  end: number;
  prefix: string;
  /** index of the last token before the word (-1 for none) */
  prevIdx: number;
  /** token holding the word, if any */
  curIdx: number;
}

/** Locate the word being typed at `offset`, and the token just before it. Null inside numbers/comments-ish. */
function wordAt(a: Analysis, offset: number): Word | null {
  const { tokens, source } = a;
  let lo = 0;
  let hi = tokens.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (tokens[mid].start < offset) {
      idx = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (idx >= 0) {
    const t = tokens[idx];
    if (t.t === 'name' && t.end >= offset) {
      return { start: t.start, end: t.end, prefix: source.slice(t.start, offset), prevIdx: idx - 1, curIdx: idx };
    }
    if (t.t === 'str' && offset >= (t.contentStart ?? t.start) && (t.unterminated ? offset <= t.end : offset <= (t.contentEnd ?? t.end))) {
      const cs = t.contentStart ?? t.start;
      return { start: cs, end: t.contentEnd ?? t.end, prefix: source.slice(cs, offset), prevIdx: idx - 1, curIdx: idx };
    }
    if (t.t === 'num' && t.end >= offset) return null;
    if (t.t === 'str' && t.end > offset) return null;
    if (t.t === 'op' || t.t === 'num' || t.t === 'str') {
      return { start: offset, end: offset, prefix: '', prevIdx: idx, curIdx: -1 };
    }
  }
  return { start: offset, end: offset, prefix: '', prevIdx: idx, curIdx: -1 };
}

function moduleItems(a: Analysis, kind: Kind, w: Word): CompletionSpec[] {
  const { catalog } = a;
  const p = w.prefix.toLowerCase();
  const items: CompletionSpec[] = [];
  const base = { start: w.start, insertEnd: w.start + w.prefix.length, replaceEnd: w.end };
  if (kind === 'commands') {
    for (const [name, cmd] of Object.entries(catalog.commands)) {
      if (!matches(name, p)) continue;
      items.push({
        label: name,
        insertText: name,
        kind: 'class',
        detail: cmd.q,
        lazyDocumentation: () => commandCard(catalog, name, cmd),
        sortText: '1' + name,
        ...base,
      });
    }
  } else {
    for (const [name, par] of Object.entries(catalog.parameters)) {
      if (!matches(name, p)) continue;
      items.push({
        label: name,
        insertText: name,
        kind: 'class',
        detail: par.q,
        lazyDocumentation: () => parameterCard(catalog, name, par),
        sortText: '1' + name,
        ...base,
      });
    }
  }
  const enums = enumsFor(catalog, kind);
  for (const [name, e] of Object.entries(enums)) {
    if (!matches(name, p)) continue;
    items.push({
      label: name,
      insertText: name,
      kind: 'enum',
      detail: `enum (${e.members.length} members)`,
      lazyDocumentation: () => enumCard(catalog, kind, name, e),
      sortText: '2' + name,
      ...base,
    });
  }
  return items;
}

function memberItems(a: Analysis, kind: Kind, enumName: string, w: Word): CompletionSpec[] {
  const e = enumsFor(a.catalog, kind)[enumName];
  if (!e) return [];
  const p = w.prefix.toLowerCase();
  const items: CompletionSpec[] = [];
  e.members.forEach((m, i) => {
    if (!matches(m.name, p)) return;
    items.push({
      label: m.name,
      insertText: m.name,
      kind: 'member',
      detail: formatValue(m.value),
      documentation: enumMemberCard(enumName, m.name, m.value),
      sortText: pad(i),
      filterText: m.name,
      start: w.start,
      insertEnd: w.start + w.prefix.length,
      replaceEnd: w.end,
    });
  });
  return items;
}

function methodItems(kind: Kind, w: Word): CompletionSpec[] {
  const list = kind === 'commands' ? COMMAND_METHODS : PARAMETER_METHODS;
  const p = w.prefix.toLowerCase();
  const items: CompletionSpec[] = [];
  list.forEach((m, i) => {
    if (!matches(m.name, p)) return;
    items.push({
      label: m.name,
      insertText: m.params.length ? `${m.name}($0)` : `${m.name}()`,
      kind: 'method',
      detail: methodSignature(m),
      documentation: methodMarkdown(m, kind === 'commands' ? 'command' : 'parameter'),
      sortText: pad(i),
      snippet: m.params.length > 0,
      start: w.start,
      insertEnd: w.start + w.prefix.length,
      replaceEnd: w.end,
    });
  });
  return items;
}

function kwargItems(a: Analysis, cmdName: string, cmd: CatalogCommand, o: number, w: Word): CompletionSpec[] {
  const { args } = callArgs(a, o);
  const used = new Set<string>();
  for (const s of args) {
    if (!s.nameTok || s.nameIdx === w.curIdx) continue;
    const arg = findArg(cmd, s.nameTok.s);
    used.add(arg ? arg.name : s.nameTok.s);
  }
  const nextIsEq = w.curIdx >= 0 && isOp(a.tokens[w.curIdx + 1], '=');
  const p = w.prefix.toLowerCase();
  const items: CompletionSpec[] = [];
  cmd.args.forEach((arg, i) => {
    if (used.has(arg.name) || !matches(arg.name, p)) return;
    const typ = argTypeLabel(arg);
    items.push({
      label: arg.name,
      insertText: nextIsEq ? arg.name : `${arg.name}=$0`,
      kind: 'kwarg',
      detail: `${typ}${arg.required ? ' (required)' : ' (optional)'}`,
      lazyDocumentation: () => argCard(a.catalog, cmdName, arg),
      sortText: (arg.required ? '0' : '1') + pad(i),
      snippet: !nextIsEq,
      retrigger: !nextIsEq && arg.type === 'enum',
      start: w.start,
      insertEnd: w.start + w.prefix.length,
      replaceEnd: w.end,
    });
  });
  return items;
}

function methodKwargItems(spec: MethodSpec, o: number, w: Word, a: Analysis): CompletionSpec[] {
  const { args } = callArgs(a, o);
  const used = new Set(args.filter((s) => s.nameTok && s.nameIdx !== w.curIdx).map((s) => s.nameTok!.s));
  const p = w.prefix.toLowerCase();
  const items: CompletionSpec[] = [];
  spec.params.forEach((param, i) => {
    if (used.has(param.name) || !matches(param.name, p)) return;
    items.push({
      label: param.name,
      insertText: `${param.name}=$0`,
      kind: 'kwarg',
      detail: paramLabel(param),
      documentation: param.doc,
      sortText: pad(i),
      snippet: true,
      start: w.start,
      insertEnd: w.start + w.prefix.length,
      replaceEnd: w.end,
    });
  });
  return items;
}

function enumValueItems(a: Analysis, arg: CatalogArg, kind: Kind, w: Word, inString: boolean): CompletionSpec[] {
  if (arg.type !== 'enum' || !arg.enum) return [];
  const e = enumsFor(a.catalog, kind)[arg.enum];
  if (!e) return [];
  const alias = aliasFor(a, kind);
  const p = w.prefix.toLowerCase();
  const items: CompletionSpec[] = [];
  const base = { start: w.start, insertEnd: w.start + w.prefix.length, replaceEnd: w.end };
  if (!inString) {
    e.members.forEach((m, i) => {
      const label = `${alias}.${arg.enum}.${m.name}`;
      if (p && !label.toLowerCase().includes(p) && !String(m.value).toLowerCase().includes(p)) return;
      items.push({
        label,
        insertText: label,
        kind: 'member',
        detail: formatValue(m.value),
        documentation: enumMemberCard(arg.enum!, m.name, m.value),
        sortText: '0' + pad(i),
        filterText: `${label} ${m.value}`,
        ...base,
      });
    });
  }
  e.members.forEach((m, i) => {
    const raw = typeof m.value === 'number' ? String(m.value) : m.value;
    if (p && !raw.toLowerCase().includes(p) && !m.name.toLowerCase().includes(p)) return;
    const quoted = typeof m.value === 'number' ? String(m.value) : pyQuote(m.value);
    const text = inString ? raw.replace(/\\/g, '\\\\').replace(/'/g, "\\'") : quoted;
    items.push({
      label: inString ? raw : quoted,
      insertText: text,
      kind: 'value',
      detail: `raw value of ${arg.enum}.${m.name}`,
      sortText: '1' + pad(i),
      filterText: inString ? raw : quoted,
      ...base,
    });
  });
  return items;
}

/** Completion items at `offset`, or null when this isn't a catalog-related position. */
export function getCompletions(a: Analysis, offset: number): CompletionSpec[] | null {
  const w = wordAt(a, offset);
  if (!w) return null;
  const { tokens } = a;
  const inString = w.curIdx >= 0 && tokens[w.curIdx].t === 'str';
  const prev: Tok | undefined = w.prevIdx >= 0 ? tokens[w.prevIdx] : undefined;

  // 1) member access: `<expr>.<word>`
  if (!inString && isOp(prev, '.') && w.prevIdx >= 1) {
    const recv = resolveExpr(a, w.prevIdx - 1);
    switch (recv.t) {
      case 'module':
        return moduleItems(a, recv.kind, w);
      case 'class':
        return recv.enum ? memberItems(a, recv.kind, recv.name, w) : [];
      case 'instance':
        return methodItems(recv.kind, w);
      default:
        return null;
    }
  }
  if (inString && isOp(prev, '.')) return null;

  // 2) inside a call
  const o = innermostCallOpenerForWord(a, w);
  if (o < 0) return null;
  if (o < 1 || tokens[o - 1].t !== 'name') return null;
  const callee = resolveExpr(a, o - 1);

  const atArgStart = !inString && (w.prevIdx === o || (isOp(prev, ',') && a.enclosing[w.prevIdx] === o));

  if (callee.t === 'class' && !callee.enum && callee.kind === 'commands') {
    const cmd = a.catalog.commands[callee.name];
    if (!cmd) return null;
    if (atArgStart) return kwargItems(a, callee.name, cmd, o, w);
    if (isOp(prev, '=') && w.prevIdx >= 1 && tokens[w.prevIdx - 1].t === 'name' && a.enclosing[w.prevIdx] === o) {
      const arg = findArg(cmd, tokens[w.prevIdx - 1].s);
      if (arg) return enumValueItems(a, arg, 'commands', w, inString);
    }
    return null;
  }
  if (callee.t === 'method') {
    const spec = (callee.owner === 'commands' ? COMMAND_METHOD_MAP : PARAMETER_METHOD_MAP).get(callee.name);
    if (spec && atArgStart) {
      return methodKwargItems(spec, o, w, a);
    }
  }
  return null;
}

function innermostCallOpenerForWord(a: Analysis, w: Word): number {
  // The word's own token (a name/string) is inside the call; use the token before it.
  if (w.curIdx >= 0) {
    let o = a.enclosing[w.curIdx];
    while (o >= 0 && !isOp(a.tokens[o], '(')) o = a.enclosing[o];
    return o;
  }
  return innermostCallOpener(a, w.start);
}

// ---------------------------------------------------------------------------------------------
// Signature help

export interface SignatureSpec {
  label: string;
  documentation: string;
  parameters: { label: [number, number]; documentation: string }[];
  activeParameter: number;
}

function buildSignature(name: string, parts: { label: string; doc: string }[], ret?: string): { label: string; parameters: SignatureSpec['parameters'] } {
  let label = `${name}(`;
  const parameters: SignatureSpec['parameters'] = [];
  parts.forEach((p, i) => {
    if (i) label += ', ';
    const s = label.length;
    label += p.label;
    parameters.push({ label: [s, label.length], documentation: p.doc });
  });
  label += ')' + (ret ? ` -> ${ret}` : '');
  return { label, parameters };
}

export function getSignature(a: Analysis, offset: number): SignatureSpec | null {
  const o = innermostCallOpener(a, offset);
  if (o < 1 || a.tokens[o - 1].t !== 'name') return null;
  const callee = resolveExpr(a, o - 1);

  // which argument is the cursor in?
  const { tokens, enclosing } = a;
  let comma = 0;
  let kw: string | undefined;
  let argStart = o + 1;
  for (let k = o + 1; k < tokens.length && tokens[k].start < offset; k++) {
    if (enclosing[k] === o && isOp(tokens[k], ',')) {
      comma++;
      argStart = k + 1;
    }
  }
  const first = tokens[argStart];
  if (first && first.t === 'name' && first.start < offset && isOp(tokens[argStart + 1], '=')) kw = first.s;

  if (callee.t === 'class' && !callee.enum && callee.kind === 'commands') {
    const cmd = a.catalog.commands[callee.name];
    if (!cmd) return null;
    const parts = cmd.args.map((x) => ({
      label: argSummary(x),
      doc: argCard(a.catalog, callee.name, x),
    }));
    const sig = buildSignature(callee.name, parts);
    let active = -1;
    if (kw) active = cmd.args.findIndex((x) => x.name === kw || x.wire === kw);
    if (active < 0) active = Math.min(comma, Math.max(cmd.args.length - 1, 0));
    return {
      label: sig.label,
      documentation: commandCard(a.catalog, callee.name, cmd, { maxArgs: 0 }),
      parameters: sig.parameters,
      activeParameter: active,
    };
  }
  if (callee.t === 'method') {
    const spec = (callee.owner === 'commands' ? COMMAND_METHOD_MAP : PARAMETER_METHOD_MAP).get(callee.name);
    if (!spec) return null;
    const sig = buildSignature(spec.name, spec.params.map((p) => ({ label: paramLabel(p), doc: p.doc })), spec.returns);
    let active = kw ? spec.params.findIndex((p) => p.name === kw) : -1;
    if (active < 0) active = Math.min(comma, Math.max(spec.params.length - 1, 0));
    return {
      label: sig.label,
      documentation: methodMarkdown(spec, callee.owner === 'commands' ? 'command' : 'parameter'),
      parameters: sig.parameters,
      activeParameter: active,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Hover

export interface HoverSpec {
  start: number;
  end: number;
  markdown: string;
}

function refCard(a: Analysis, ref: Ref): string | null {
  const { catalog } = a;
  switch (ref.t) {
    case 'class':
    case 'instance': {
      if (ref.kind === 'commands') {
        const c = catalog.commands[ref.name];
        if (c) return commandCard(catalog, ref.name, c);
        const e = catalog.enums[ref.name];
        return e ? enumCard(catalog, 'commands', ref.name, e) : null;
      }
      const p = catalog.parameters[ref.name];
      if (p) return parameterCard(catalog, ref.name, p);
      const e = catalog.paramEnums[ref.name];
      return e ? enumCard(catalog, 'parameters', ref.name, e) : null;
    }
    case 'enumMember': {
      const m = enumsFor(catalog, ref.kind)[ref.enum]?.members.find((x) => x.name === ref.member);
      return m ? enumMemberCard(ref.enum, m.name, m.value) : null;
    }
    case 'method': {
      const spec = (ref.owner === 'commands' ? COMMAND_METHOD_MAP : PARAMETER_METHOD_MAP).get(ref.name);
      return spec ? methodMarkdown(spec, ref.owner === 'commands' ? 'command' : 'parameter') : null;
    }
    case 'module': {
      const n = ref.kind === 'commands' ? Object.keys(catalog.commands).length : Object.keys(catalog.parameters).length;
      const ne = Object.keys(enumsFor(catalog, ref.kind)).length;
      return `**framework.${catalog.mission.toLowerCase()}.${ref.kind}** — generated ${catalog.mission} MDB module\n\n${n} ${ref.kind}, ${ne} enums\n\n_${catalog.source}_`;
    }
    default:
      return null;
  }
}

export function getHover(a: Analysis, offset: number): HoverSpec | null {
  const { tokens } = a;
  let idx = -1;
  for (let lo = 0, hi = tokens.length - 1; lo <= hi; ) {
    const mid = (lo + hi) >> 1;
    if (tokens[mid].start <= offset) {
      idx = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (idx < 0) return null;
  const t = tokens[idx];
  if (t.t !== 'name' || offset >= t.end) return null;

  // kwarg name inside a command call
  if (isOp(tokens[idx + 1], '=') && !isOp(tokens[idx - 1], '.')) {
    let o = a.enclosing[idx];
    while (o >= 0 && !isOp(tokens[o], '(')) o = a.enclosing[o];
    if (o >= 1 && tokens[o - 1].t === 'name' && (isOp(tokens[idx - 1], '(') || isOp(tokens[idx - 1], ',')) && a.enclosing[idx] === o) {
      const callee = resolveExpr(a, o - 1);
      if (callee.t === 'class' && !callee.enum && callee.kind === 'commands') {
        const cmd = a.catalog.commands[callee.name];
        const arg = cmd && findArg(cmd, t.s);
        if (arg) return { start: t.start, end: t.end, markdown: argCard(a.catalog, callee.name, arg) };
      } else if (callee.t === 'method') {
        const spec = (callee.owner === 'commands' ? COMMAND_METHOD_MAP : PARAMETER_METHOD_MAP).get(callee.name);
        const p = spec?.params.find((x) => x.name === t.s);
        if (p) return { start: t.start, end: t.end, markdown: `\`${paramLabel(p)}\`\n\n${p.doc}` };
      }
    }
  }

  const ref = resolveExpr(a, idx);
  // plain variable / unknown names get no card unless they resolve to something catalog-related
  const md = refCard(a, ref);
  return md ? { start: t.start, end: t.end, markdown: md } : null;
}

// ---------------------------------------------------------------------------------------------
// Diagnostics

export interface CatalogDiagnostic {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  /** replacement texts for the range, best first */
  fixes?: string[];
}

export const DIAGNOSTIC_OWNER = 'mos-catalog';

const similarCache = new WeakMap<Catalog, Map<string, string[]>>();

function suggestClasses(catalog: Catalog, kind: Kind, name: string): string[] {
  let m = similarCache.get(catalog);
  if (!m) similarCache.set(catalog, (m = new Map()));
  const key = `${kind}:${name}`;
  let hit = m.get(key);
  if (!hit) {
    const pool = [...Object.keys(kind === 'commands' ? catalog.commands : catalog.parameters), ...Object.keys(enumsFor(catalog, kind))];
    hit = closestNames(name, pool, 3);
    m.set(key, hit);
  }
  return hit;
}

function didYouMean(list: string[]): string {
  return list.length ? ` Did you mean ${list.map((s) => `'${s}'`).join(', ')}?` : '';
}

function listPreview(items: string[], max = 6): string {
  return items.slice(0, max).join(', ') + (items.length > max ? `, … (+${items.length - max})` : '');
}

/** Compute catalog-based diagnostics for a document. */
export function validateSource(source: string, catalog: Catalog): CatalogDiagnostic[] {
  return validateAnalysis(analyze(source, catalog));
}

export function validateAnalysis(a: Analysis): CatalogDiagnostic[] {
  const { tokens, catalog } = a;
  const out: CatalogDiagnostic[] = [];
  const mission = catalog.mission;

  const push = (sev: 'error' | 'warning', code: string, message: string, startTok: Tok, endTok: Tok, fixes?: string[]) => {
    const s = offsetToPos(a, startTok.start);
    const e = offsetToPos(a, endTok.end);
    out.push({
      severity: sev,
      code,
      message,
      startLineNumber: s.line,
      startColumn: s.column,
      endLineNumber: e.line,
      endColumn: e.column,
      fixes: fixes && fixes.length ? fixes : undefined,
    });
  };

  // enum string literal checks
  const checkRawString = (tok: Tok, enumName: string, kind: Kind, label: string) => {
    if (tok.t !== 'str' || tok.fstring || tok.unterminated || /^[bB]/.test(tok.s)) return;
    const e = enumsFor(catalog, kind)[enumName];
    if (!e) return;
    const val = tok.value ?? '';
    if (e.members.some((m) => String(m.value) === val)) return;
    const values = e.members.map((m) => String(m.value));
    const near = closestNames(val, values, 3);
    push(
      'warning',
      'invalid-enum-value',
      `'${val}' is not a valid value for ${label} (${enumName}).${didYouMean(near)} Valid values: ${listPreview(values.map((v) => `'${v}'`))}`,
      tok,
      tok,
      near.map(pyQuote),
    );
  };

  // 1) every `<expr>.<name>` whose receiver resolves to a module / enum class
  for (let i = 2; i < tokens.length; i++) {
    const tk = tokens[i];
    if (tk.t !== 'name' || !isOp(tokens[i - 1], '.')) continue;
    const prevTok = tokens[i - 2];
    if (prevTok.t !== 'name') continue;
    const ref = resolveExpr(a, i);
    if (ref.t === 'missing') {
      const near = suggestClasses(catalog, ref.kind, ref.name);
      const noun = ref.kind === 'commands' ? 'command' : 'parameter';
      push('error', ref.kind === 'commands' ? 'unknown-command' : 'unknown-parameter', `'${ref.name}' is not a ${noun} in the ${mission} MDB.${didYouMean(near)}`, tk, tk, near);
    } else if (ref.t === 'badMember') {
      const e = enumsFor(catalog, ref.kind)[ref.enum];
      const names = e ? e.members.map((m) => m.name) : [];
      // also match by raw value (e.g. Enum.Acceptance -> ACCEPTANCE)
      const byValue = e ? e.members.filter((m) => String(m.value).toLowerCase() === ref.member.toLowerCase()).map((m) => m.name) : [];
      const near = [...new Set([...byValue, ...closestNames(ref.member, names, 3)])].slice(0, 3);
      push('error', 'unknown-enum-member', `'${ref.member}' is not a member of ${ref.enum}.${didYouMean(near)} Members: ${listPreview(names)}`, tk, tk, near);
    }
  }

  // 2) calls
  for (let o = 1; o < tokens.length; o++) {
    if (!isOp(tokens[o], '(') || tokens[o - 1].t !== 'name') continue;
    const callee = resolveExpr(a, o - 1);
    const nameTok = tokens[o - 1];

    if (callee.t === 'class' && callee.enum) {
      const { args } = callArgs(a, o);
      if (args.length === 1 && !args[0].nameTok && args[0].valueStart >= 0 && args[0].valueStart === args[0].valueEnd) {
        checkRawString(tokens[args[0].valueStart], callee.name, callee.kind, callee.name);
      }
      continue;
    }
    if (!(callee.t === 'class' && callee.kind === 'commands')) continue;
    const cmd = catalog.commands[callee.name];
    if (!cmd) continue;
    const { args, closed, hasStar } = callArgs(a, o);
    const provided = new Set<string>();

    for (const s of args) {
      if (!s.nameTok) continue;
      const kw = s.nameTok.s;
      const arg = findArg(cmd, kw);
      if (!arg) {
        const wires = Object.keys(cmd.fixed);
        if (wires.includes(kw.replace(/^field_/, '').replace(/^_/, ''))) {
          push('warning', 'preassigned-argument', `'${kw}' is a pre-assigned argument of ${callee.name} and cannot be set.`, s.nameTok, s.nameTok);
        } else {
          const near = closestNames(kw, cmd.args.map((x) => x.name), 3);
          const valid = cmd.args.map((x) => x.name);
          push(
            'error',
            'unknown-argument',
            `'${kw}' is not an argument of ${callee.name}.${didYouMean(near)}${valid.length ? ` Arguments: ${listPreview(valid)}` : ' It takes no arguments.'}`,
            s.nameTok,
            s.nameTok,
            near,
          );
        }
        continue;
      }
      provided.add(arg.name);
      if (arg.type === 'enum' && arg.enum && s.valueStart >= 0) {
        if (s.valueStart === s.valueEnd && tokens[s.valueStart].t === 'str') {
          checkRawString(tokens[s.valueStart], arg.enum, 'commands', arg.name);
        } else {
          const vref = resolveExpr(a, s.valueEnd);
          if (vref.t === 'enumMember' && (vref.enum !== arg.enum || vref.kind !== 'commands')) {
            push(
              'warning',
              'enum-mismatch',
              `${arg.name} expects a ${arg.enum} value, not ${vref.kind === 'commands' ? '' : 'a parameter enum '}${vref.enum}.`,
              tokens[s.valueStart],
              tokens[s.valueEnd],
            );
          }
        }
      }
    }

    if (closed && !hasStar) {
      const missing = cmd.args.filter((x) => x.required && !provided.has(x.name)).map((x) => x.name);
      if (missing.length) {
        push('warning', 'missing-argument', `Missing required argument${missing.length > 1 ? 's' : ''} for ${callee.name}: ${missing.join(', ')}`, nameTok, nameTok);
      }
    }
  }

  out.sort((x, y) => x.startLineNumber - y.startLineNumber || x.startColumn - y.startColumn);
  return out;
}

export { pyQuote };
