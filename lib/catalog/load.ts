import type { Catalog, CatalogCommand, CatalogParameter } from './types';

export type Mission = Catalog['mission'];

const cache = new Map<Mission, Promise<Catalog>>();

/** Fetch `/catalog/<mission>.json` once per page load; the promise is cached (and dropped again on failure). */
export function loadCatalog(mission: Mission): Promise<Catalog> {
  let p = cache.get(mission);
  if (!p) {
    p = fetch(`/catalog/${mission.toLowerCase()}.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load ${mission} catalog: HTTP ${res.status}`);
        return res.json() as Promise<Catalog>;
      })
      .then((catalog) => {
        getCatalogIndex(catalog); // warm the lookup indexes off the keystroke path
        return catalog;
      })
      .catch((err) => {
        cache.delete(mission);
        throw err;
      });
    cache.set(mission, p);
  }
  return p;
}

/** Test/dev hook: forget cached catalog promises. */
export function clearCatalogCache(): void {
  cache.clear();
}

// ---------------------------------------------------------------------------------------------
// Indexes

export interface SearchEntry {
  kind: 'command' | 'parameter';
  name: string;
  nameLower: string;
  q: string;
  qLower: string;
  descLower: string;
  subsystem: string;
}

export interface CatalogIndex {
  commandByQ: Map<string, string>;
  parameterByQ: Map<string, string>;
  /** all commands and parameters, sorted by class name */
  entries: SearchEntry[];
  subsystems: string[];
}

const indexes = new WeakMap<Catalog, CatalogIndex>();

export function getCatalogIndex(catalog: Catalog): CatalogIndex {
  let idx = indexes.get(catalog);
  if (idx) return idx;
  const commandByQ = new Map<string, string>();
  const parameterByQ = new Map<string, string>();
  const entries: SearchEntry[] = [];
  const subsystems = new Set<string>();
  const add = (kind: SearchEntry['kind'], name: string, item: CatalogCommand | CatalogParameter) => {
    entries.push({
      kind,
      name,
      nameLower: name.toLowerCase(),
      q: item.q,
      qLower: item.q.toLowerCase(),
      descLower: (item.description ?? '').toLowerCase(),
      subsystem: item.subsystem,
    });
    if (item.subsystem) subsystems.add(item.subsystem);
  };
  for (const [name, c] of Object.entries(catalog.commands)) {
    commandByQ.set(c.q, name);
    add('command', name, c);
  }
  for (const [name, p] of Object.entries(catalog.parameters)) {
    parameterByQ.set(p.q, name);
    add('parameter', name, p);
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  idx = { commandByQ, parameterByQ, entries, subsystems: [...subsystems].sort() };
  indexes.set(catalog, idx);
  return idx;
}

/** Look up a command class name by qualified name (`/FF/EPS/Swt_aocs3v3BkMn`). */
export function commandByQualifiedName(catalog: Catalog, q: string): { name: string; command: CatalogCommand } | undefined {
  const name = getCatalogIndex(catalog).commandByQ.get(q);
  return name ? { name, command: catalog.commands[name] } : undefined;
}

/** Look up a parameter class name by qualified name (`/FF/AOCS/Aocs_Mode`). */
export function parameterByQualifiedName(catalog: Catalog, q: string): { name: string; parameter: CatalogParameter } | undefined {
  const name = getCatalogIndex(catalog).parameterByQ.get(q);
  return name ? { name, parameter: catalog.parameters[name] } : undefined;
}

// ---------------------------------------------------------------------------------------------
// Search

export interface SearchOptions {
  kind?: 'command' | 'parameter';
  subsystem?: string;
  limit?: number;
}

export interface SearchResult {
  kind: 'command' | 'parameter';
  /** Python class name */
  name: string;
  q: string;
  subsystem: string;
  description?: string;
  score: number;
}

// Tier weights. Higher wins; ties broken by shorter class name, then alphabetically.
const T_EXACT = 5;
const T_PREFIX = 4;
const T_NAME = 3;
const T_Q = 2;
const T_DESC = 1;

function tokenTier(e: SearchEntry, tok: string): number {
  if (e.nameLower === tok) return T_EXACT;
  if (e.nameLower.startsWith(tok)) return T_PREFIX;
  if (e.nameLower.includes(tok)) return T_NAME;
  if (e.qLower.includes(tok)) return T_Q;
  if (e.descLower.includes(tok)) return T_DESC;
  return 0;
}

/**
 * Ranked search over class names, qualified names and descriptions.
 * Whitespace-separated tokens must all match; ranking is driven by the first (primary) token:
 * exact class name > class-name prefix > class-name substring > qualified-name substring > description substring.
 * Empty query returns the first `limit` entries alphabetically.
 */
export function searchCatalog(catalog: Catalog, query: string, opts: SearchOptions = {}): SearchResult[] {
  const limit = opts.limit ?? 50;
  const { entries } = getCatalogIndex(catalog);
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hits: { e: SearchEntry; score: number }[] = [];

  for (const e of entries) {
    if (opts.kind && e.kind !== opts.kind) continue;
    if (opts.subsystem && e.subsystem !== opts.subsystem) continue;
    let score = 0;
    if (tokens.length === 0) {
      score = 0;
    } else {
      let ok = true;
      let total = 0;
      for (let i = 0; i < tokens.length; i++) {
        const tier = tokenTier(e, tokens[i]);
        if (tier === 0) {
          ok = false;
          break;
        }
        total += i === 0 ? tier * 1000 : tier * 10;
      }
      if (!ok) continue;
      score = total;
    }
    hits.push({ e, score: score - e.name.length / 1000 });
  }

  if (tokens.length === 0) {
    // already alphabetical
  } else {
    hits.sort((a, b) => b.score - a.score || (a.e.name < b.e.name ? -1 : 1));
  }

  const out: SearchResult[] = [];
  for (let i = 0; i < hits.length && out.length < limit; i++) {
    const { e, score } = hits[i];
    const item = e.kind === 'command' ? catalog.commands[e.name] : catalog.parameters[e.name];
    out.push({
      kind: e.kind,
      name: e.name,
      q: e.q,
      subsystem: e.subsystem,
      description: item.description,
      score,
    });
  }
  return out;
}
