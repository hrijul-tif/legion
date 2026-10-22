// Markdown cards (hover / completion documentation) for catalog entries. Pure functions.

import type { Catalog, CatalogArg, CatalogCommand, CatalogEnum, CatalogParameter } from '../catalog/types';

export type ModuleKind = 'commands' | 'parameters';

const MAX_ARG_ROWS = 14;
const MAX_ENUM_INLINE = 6;
const MAX_ENUM_BLOCK = 14;
const MAX_FIXED = 8;

/** Escape text for use inside a markdown table cell. */
export function cell(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').replace(/[`*_<>]/g, (c) => '\\' + c);
}

function code(text: string): string {
  return '`' + text.replace(/`/g, "'") + '`';
}

export function enumsFor(catalog: Catalog, kind: ModuleKind): Record<string, CatalogEnum> {
  return kind === 'commands' ? catalog.enums : catalog.paramEnums;
}

export function formatValue(v: string | number): string {
  return typeof v === 'number' ? String(v) : `'${v}'`;
}

function enumValuesInline(e: CatalogEnum | undefined, max = MAX_ENUM_INLINE): string {
  if (!e) return '';
  const vals = e.members.slice(0, max).map((m) => code(formatValue(m.value)));
  const more = e.members.length - max;
  return vals.join(', ') + (more > 0 ? ` … (+${more})` : '');
}

export function argTypeLabel(arg: CatalogArg): string {
  return arg.type === 'enum' && arg.enum ? arg.enum : arg.type;
}

export function argSummary(arg: CatalogArg): string {
  const def = arg.default !== undefined ? ` = ${JSON.stringify(arg.default)}` : '';
  return `${arg.name}: ${argTypeLabel(arg)}${arg.required ? '' : def || ' = ...'}`;
}

export function commandCard(catalog: Catalog, name: string, cmd: CatalogCommand, opts: { maxArgs?: number } = {}): string {
  const maxArgs = opts.maxArgs ?? MAX_ARG_ROWS;
  const lines: string[] = [`**${name}** — ${code(cmd.q)}`, '', `Command · subsystem **${cmd.subsystem}** · ${catalog.mission} MDB`];
  if (cmd.description) lines.push('', cmd.description);
  if (cmd.args.length) {
    lines.push('', '| Argument | Type | Required | Notes |', '| --- | --- | --- | --- |');
    for (const a of cmd.args.slice(0, maxArgs)) {
      const notes: string[] = [];
      if (a.description) notes.push(cell(a.description));
      if (a.type === 'enum' && a.enum) notes.push(enumValuesInline(catalog.enums[a.enum]).replace(/\|/g, '\\|'));
      else if (a.default !== undefined) notes.push('default ' + code(String(a.default)));
      lines.push(`| ${code(a.name)} | ${code(argTypeLabel(a))} | ${a.required ? 'yes' : 'no'} | ${notes.join(' — ')} |`);
    }
    if (cmd.args.length > maxArgs) lines.push('', `… and ${cmd.args.length - maxArgs} more argument(s)`);
  } else {
    lines.push('', '_No user arguments._');
  }
  const fixed = Object.entries(cmd.fixed);
  if (fixed.length) {
    const shown = fixed.slice(0, MAX_FIXED).map(([k, v]) => `${code(k)}=${code(v)}`);
    lines.push('', `Pre-assigned: ${shown.join(', ')}${fixed.length > MAX_FIXED ? ` … (+${fixed.length - MAX_FIXED})` : ''}`);
  }
  return lines.join('\n');
}

export function parameterCard(catalog: Catalog, name: string, p: CatalogParameter): string {
  const lines: string[] = [`**${name}** — ${code(p.q)}`, '', `Parameter (${p.kind}) · subsystem **${p.subsystem}** · ${catalog.mission} MDB`];
  if (p.description) lines.push('', p.description);
  const typ = p.type === 'enum' && p.enum ? p.enum : p.type;
  lines.push('', `Value field ${code(p.field || '—')} : ${code(typ)}`);
  if (p.type === 'enum' && p.enum) {
    const e = catalog.paramEnums[p.enum];
    if (e) lines.push('', 'Values: ' + enumValuesInline(e, MAX_ENUM_BLOCK));
  }
  lines.push('', 'Read it with `.read_latest_parameter_value()`, `.read_fresh_parameter_value()` or pass it to `execute_check_tm_*`.');
  return lines.join('\n');
}

export function enumCard(catalog: Catalog, kind: ModuleKind, name: string, e: CatalogEnum): string {
  const alias = kind === 'commands' ? 'commands' : 'parameters';
  const lines: string[] = [`**${name}** — enum in ${catalog.mission} ${alias} (${e.members.length} members)`, '', '```python'];
  for (const m of e.members.slice(0, MAX_ENUM_BLOCK)) lines.push(`${m.name} = ${formatValue(m.value)}`);
  if (e.members.length > MAX_ENUM_BLOCK) lines.push(`# … ${e.members.length - MAX_ENUM_BLOCK} more`);
  lines.push('```');
  return lines.join('\n');
}

export function enumMemberCard(enumName: string, member: string, value: string | number): string {
  return `**${enumName}.${member}** = ${code(formatValue(value))}`;
}

export function argCard(catalog: Catalog, cmdName: string, a: CatalogArg): string {
  const lines = [
    `**${a.name}** — argument of ${code(cmdName)}`,
    '',
    `Type ${code(argTypeLabel(a))} · ${a.required ? 'required' : 'optional'}${a.wire !== a.name ? ` · wire name ${code(a.wire)}` : ''}`,
  ];
  if (a.default !== undefined) lines.push('', `Default ${code(JSON.stringify(a.default))}`);
  if (a.description) lines.push('', a.description);
  if (a.type === 'enum' && a.enum) {
    const e = catalog.enums[a.enum];
    if (e) lines.push('', `Accepted values (${a.enum}): ` + enumValuesInline(e, MAX_ENUM_BLOCK));
  }
  return lines.join('\n');
}
