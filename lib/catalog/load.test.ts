import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearCatalogCache,
  commandByQualifiedName,
  getCatalogIndex,
  loadCatalog,
  parameterByQualifiedName,
  searchCatalog,
} from './load';
import { closestNames } from './similar';
import { fixtureCatalog as catalog } from './fixture';

describe('searchCatalog', () => {
  it('ranks exact > prefix > class substring > qualified-name substring > description', () => {
    const c = structuredClone(catalog);
    c.commands.Exact = { q: '/FF/X/Y', subsystem: 'X', args: [], fixed: {} };
    c.commands.ExactPlus = { q: '/FF/X/Z', subsystem: 'X', args: [], fixed: {} };
    c.commands.MyExactThing = { q: '/FF/X/W', subsystem: 'X', args: [], fixed: {} };
    c.commands.QOnly = { q: '/FF/X/Exact_Path', subsystem: 'X', args: [], fixed: {} };
    c.commands.DescOnly = { q: '/FF/X/V', subsystem: 'X', description: 'does the exact thing', args: [], fixed: {} };
    const names = searchCatalog(c, 'exact').map((r) => r.name);
    expect(names).toEqual(['Exact', 'ExactPlus', 'MyExactThing', 'QOnly', 'DescOnly']);
  });

  it('is case-insensitive and matches qualified names', () => {
    expect(searchCatalog(catalog, 'swt_aocs')[0].name).toBe('EPSSwtAocs3v3BkMn');
    expect(searchCatalog(catalog, '/ff/eps').map((r) => r.name).sort()).toEqual(['EPSBatteryVoltage', 'EPSSwtAocs3v3BkMn']);
  });

  it('filters by kind and subsystem and honours limit', () => {
    const params = searchCatalog(catalog, '', { kind: 'parameter' });
    expect(params.every((r) => r.kind === 'parameter')).toBe(true);
    expect(params).toHaveLength(2);
    expect(searchCatalog(catalog, '', { subsystem: 'AOCS' }).map((r) => r.name).sort()).toEqual(['AOCSAocsMode', 'AOCSSetImuPLpfCutFreq']);
    expect(searchCatalog(catalog, '', { limit: 2 })).toHaveLength(2);
  });

  it('requires all tokens to match', () => {
    expect(searchCatalog(catalog, 'payload image').map((r) => r.name)).toEqual(['PayloadCaptureImage']);
    expect(searchCatalog(catalog, 'payload voltage')).toEqual([]);
  });

  it('searches descriptions', () => {
    expect(searchCatalog(catalog, 'camera').map((r) => r.name)).toEqual(['PayloadCaptureImage']);
  });

  it('is fast on a large catalog', () => {
    const c = structuredClone(catalog);
    for (let i = 0; i < 6000; i++) {
      c.commands[`Gen${i}Command`] = { q: `/FF/GEN/Cmd_${i}`, subsystem: 'GEN', description: 'generated', args: [], fixed: {} };
    }
    getCatalogIndex(c);
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) searchCatalog(c, 'gen59', { limit: 50 });
    expect((performance.now() - t0) / 20).toBeLessThan(25);
  });
});

describe('indexes', () => {
  it('looks up by qualified name', () => {
    expect(commandByQualifiedName(catalog, '/FF/EPS/Swt_aocs3v3BkMn')?.name).toBe('EPSSwtAocs3v3BkMn');
    expect(parameterByQualifiedName(catalog, '/FF/AOCS/Aocs_Mode')?.name).toBe('AOCSAocsMode');
    expect(commandByQualifiedName(catalog, '/FF/nope')).toBeUndefined();
  });
});

describe('closestNames', () => {
  it('finds near misses', () => {
    expect(closestNames('EPSSwtAocs3v3BkMnn', Object.keys(catalog.commands))[0]).toBe('EPSSwtAocs3v3BkMn');
    expect(closestNames('PayloadCapture', Object.keys(catalog.commands))[0]).toBe('PayloadCaptureImage');
    expect(closestNames('zzzzzzzz', Object.keys(catalog.commands))).toEqual([]);
  });
});

describe('loadCatalog', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearCatalogCache();
  });

  it('fetches once and caches the promise per mission', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => catalog }));
    vi.stubGlobal('fetch', fetchMock);
    const [a, b] = await Promise.all([loadCatalog('FF'), loadCatalog('FF')]);
    expect(a).toBe(b);
    await loadCatalog('FF');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/catalog/ff.json');
  });

  it('does not cache failures', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(loadCatalog('JTYU')).rejects.toThrow(/404/);
    await expect(loadCatalog('JTYU')).rejects.toThrow(/404/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
