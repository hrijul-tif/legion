import type { Catalog } from "../catalog/types";
import { detectAliases, detectImportedNames } from "../editor/catalog-analysis";

/** Telemetry parameters / commands a procedure refers to (drives the inspector's pinned rows and fault pickers). */

export interface ReferencedItem {
  /** python class name */
  name: string;
  q: string;
  /** first line where it is used */
  line: number;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function referenced(
  code: string,
  catalog: Catalog,
  kind: "commands" | "parameters",
): ReferencedItem[] {
  const table = kind === "commands" ? catalog.commands : catalog.parameters;
  const aliases = [...detectAliases(code)]
    .filter(
      ([, info]) => info.kind === kind && info.mission === catalog.mission,
    )
    .map(([alias]) => alias)
    .sort((a, b) => b.length - a.length);
  const imported = [...detectImportedNames(code)].filter(
    ([, info]) => info.kind === kind && info.mission === catalog.mission,
  );

  const out = new Map<string, ReferencedItem>();
  const lines = code.split("\n");
  const aliasRe = aliases.length
    ? new RegExp(
        `(?<![\\w.])(?:${aliases.map(escapeRe).join("|")})\\s*\\.\\s*([A-Za-z_]\\w*)`,
        "g",
      )
    : null;
  const importedRe = imported.length
    ? new RegExp(
        `(?<![\\w.])(${imported.map(([local]) => escapeRe(local)).join("|")})\\b`,
        "g",
      )
    : null;

  lines.forEach((text, i) => {
    const stripped = text.replace(/#.*$/, "");
    if (/^\s*(import|from)\s/.test(stripped)) return;
    for (const m of aliasRe ? stripped.matchAll(aliasRe) : []) {
      const item = table[m[1]];
      if (item && !out.has(m[1]))
        out.set(m[1], { name: m[1], q: item.q, line: i + 1 });
    }
    for (const m of importedRe ? stripped.matchAll(importedRe) : []) {
      const real = imported.find(([local]) => local === m[1])?.[1].name ?? m[1];
      const item = table[real];
      if (item && !out.has(real))
        out.set(real, { name: real, q: item.q, line: i + 1 });
    }
  });
  return [...out.values()];
}

export const referencedParameters = (code: string, catalog: Catalog) =>
  referenced(code, catalog, "parameters");
export const referencedCommands = (code: string, catalog: Catalog) =>
  referenced(code, catalog, "commands");
