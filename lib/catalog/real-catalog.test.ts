// Sanity checks against the generated public/catalog/ff.json (skipped when it has not been built).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyze, getCompletions, validateAnalysis } from '../editor/catalog-analysis';
import { searchCatalog } from './load';
import type { Catalog } from './types';

const file = join(process.cwd(), 'public/catalog/ff.json');
const run = existsSync(file) ? describe : describe.skip;

run('generated FF catalog', () => {
  const catalog = (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}) as Catalog;

  it('has the expected shape and size', () => {
    expect(catalog.mission).toBe('FF');
    expect(Object.keys(catalog.commands).length).toBeGreaterThan(1700);
    expect(Object.keys(catalog.parameters).length).toBeGreaterThan(3800);
    expect(Object.keys(catalog.enums).length).toBeGreaterThan(170);
    expect(Object.keys(catalog.paramEnums).length).toBeGreaterThan(210);
  });

  it('contains the known reference entries', () => {
    const cmd = catalog.commands.EPSSwtAocs3v3BkMn;
    expect(cmd.q).toBe('/FF/EPS/Swt_aocs3v3BkMn');
    expect(cmd.subsystem).toBe('EPS');
    expect(cmd.args.map((a) => [a.name, a.type, a.enum, a.required])).toEqual([
      ['On_Off_State', 'enum', 'NullConfigOnoffEnum', true],
      ['Pus_Acknowledgement_Flags', 'enum', 'PusAckFlagsEnum', true],
      ['Command_Timetag', 'datetime', undefined, false],
    ]);
    expect(catalog.enums.PusAckFlagsEnum.members[0]).toEqual({ name: 'ACCEPTANCE___COMPLETION', value: 'Acceptance | Completion' });
    expect(catalog.parameters.AOCSAocsMode).toMatchObject({ q: '/FF/AOCS/Aocs_Mode', kind: 'enumeration', field: 'Aocs_Mode', type: 'enum', enum: 'AocsModeEnum' });
  });

  it('powers search, completion and validation', () => {
    expect(searchCatalog(catalog, 'EPSSwtAocs3v3BkMn')[0].name).toBe('EPSSwtAocs3v3BkMn');
    const header = 'import framework.ff.commands as comm\nimport framework.ff.parameters as param\n';
    const src = `${header}comm.`;
    const items = getCompletions(analyze(src, catalog), src.length)!;
    expect(items.length).toBe(Object.keys(catalog.commands).length + Object.keys(catalog.enums).length);
    const ok = `${header}comm.EPSSwtAocs3v3BkMn(On_Off_State=comm.NullConfigOnoffEnum.ON, Pus_Acknowledgement_Flags='Acceptance | Completion')\n`;
    expect(validateAnalysis(analyze(ok, catalog))).toEqual([]);
  });
});
