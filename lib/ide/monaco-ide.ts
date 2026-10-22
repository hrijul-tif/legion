"use client";

/**
 * Idempotent Monaco wiring for the IDE. Everything global (language-service providers, catalog intellisense,
 * marker hygiene) is registered exactly once per Monaco instance — React <Activity> and StrictMode re-run
 * effects, so every entry point here is safe to call repeatedly.
 */
import type * as Monaco from "monaco-editor";
import { getLangClient } from "../editor/lang-client";
import {
  PROBLEM_OWNERS,
  registerPythonLanguageFeatures,
  type PythonLanguageHandle,
} from "../editor/python-language";
import { DIAGNOSTIC_OWNER } from "../editor/catalog-analysis";
import { validateCatalogUsage } from "../editor/catalog-intellisense";
import { loadCatalog } from "../catalog/load";
import type { Catalog } from "../catalog/types";
import type { MosDiagnostic, MosEntry } from "../editor/lang-protocol";
import { bindModelToMission } from "@/components/mos/code/monaco-setup";

type MonacoNS = typeof Monaco;
type Mission = Catalog["mission"];

export interface EntryState {
  entry: MosEntry | null;
  diagnostics: MosDiagnostic[];
  /** a check has completed at least once */
  checked: boolean;
}

interface Registry {
  handle: PythonLanguageHandle;
  missions: Map<string, Mission>;
  entries: Map<string, EntryState>;
  listeners: Map<string, Set<(s: EntryState) => void>>;
  catalogs: Map<Mission, Catalog>;
  markerHygiene: Monaco.IDisposable;
}

const KEY = Symbol.for("mos.ide.language");
type WithRegistry = MonacoNS & { [KEY]?: Registry };

export const ALL_PROBLEM_OWNERS: readonly string[] = [
  ...PROBLEM_OWNERS,
  DIAGNOSTIC_OWNER,
];

export function ensureLanguage(monaco: MonacoNS): Registry {
  const host = monaco as WithRegistry;
  if (host[KEY]) return host[KEY];

  const missions = new Map<string, Mission>();
  const entries = new Map<string, EntryState>();
  const listeners = new Map<string, Set<(s: EntryState) => void>>();
  const catalogs = new Map<Mission, Catalog>();

  const handle = registerPythonLanguageFeatures(monaco, {
    client: getLangClient(),
    getMission: (model) => missions.get(model.uri.toString()) ?? null,
    getEnums: (mission) => {
      const c = mission ? catalogs.get(mission) : undefined;
      return c
        ? {
            commands: Object.keys(c.enums),
            parameters: Object.keys(c.paramEnums),
          }
        : undefined;
    },
    onEntry: (model, entry, diagnostics) => {
      const key = model.uri.toString();
      const state: EntryState = { entry, diagnostics, checked: true };
      entries.set(key, state);
      listeners.get(key)?.forEach((cb) => cb(state));
    },
  });

  // The Python language service attaches to every python model (read-only viewers, diff "original" sides).
  // Only models the IDE registered keep Ruff/MOS squiggles; frozen history stays clean.
  let busy = false;
  const markerHygiene = monaco.editor.onDidChangeMarkers((uris) => {
    if (busy) return;
    busy = true;
    try {
      for (const uri of uris) {
        if (missions.has(uri.toString())) continue;
        for (const owner of PROBLEM_OWNERS) {
          if (monaco.editor.getModelMarkers({ resource: uri, owner }).length) {
            const model = monaco.editor.getModel(uri);
            if (model) monaco.editor.setModelMarkers(model, owner, []);
          }
        }
      }
    } finally {
      busy = false;
    }
  });

  host[KEY] = { handle, missions, entries, listeners, catalogs, markerHygiene };
  return host[KEY];
}

/** Registers a model with the IDE (mission lookup, catalog intellisense, language service). Returns a disposer. */
export function attachModel(
  monaco: MonacoNS,
  model: Monaco.editor.ITextModel,
  mission: Mission,
): () => void {
  const reg = ensureLanguage(monaco);
  const key = model.uri.toString();
  reg.missions.set(key, mission);
  const unbind = bindModelToMission(monaco, model, mission);
  void loadCatalog(mission)
    .then((c) => {
      reg.catalogs.set(mission, c);
    })
    .catch(() => undefined);
  return () => {
    unbind();
    reg.missions.delete(key);
    reg.entries.delete(key);
  };
}

/** Gets the latest parsed entry signature now and on every later check. */
export function subscribeEntry(
  monaco: MonacoNS,
  model: Monaco.editor.ITextModel,
  cb: (s: EntryState) => void,
): () => void {
  const reg = ensureLanguage(monaco);
  const key = model.uri.toString();
  let set = reg.listeners.get(key);
  if (!set) reg.listeners.set(key, (set = new Set()));
  set.add(cb);
  const current = reg.entries.get(key);
  if (current) cb(current);
  return () => {
    set.delete(cb);
  };
}

/* --------------------------------------------------------------- problems */

export type ProblemSeverity = "error" | "warning" | "info";

export interface Problem {
  key: string;
  owner: string;
  severity: ProblemSeverity;
  code: string;
  message: string;
  source: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

function severityOf(
  monaco: MonacoNS,
  s: Monaco.MarkerSeverity,
): ProblemSeverity {
  return s === monaco.MarkerSeverity.Error
    ? "error"
    : s === monaco.MarkerSeverity.Warning
      ? "warning"
      : "info";
}

function toProblem(
  monaco: MonacoNS,
  owner: string,
  m: Monaco.editor.IMarkerData,
  i: number,
): Problem {
  const code = typeof m.code === "string" ? m.code : (m.code?.value ?? "");
  return {
    key: `${owner}:${code}:${m.startLineNumber}:${m.startColumn}:${i}`,
    owner,
    severity: severityOf(monaco, m.severity),
    code,
    message: m.message,
    source: m.source ?? owner,
    line: m.startLineNumber,
    column: m.startColumn,
    endLine: m.endLineNumber,
    endColumn: m.endColumn,
  };
}

/** Markers of the Ruff, MOS and catalog (`mos-catalog`) checks, sorted by position. */
export function collectProblems(
  monaco: MonacoNS,
  model: Monaco.editor.ITextModel,
): Problem[] {
  const out: Problem[] = [];
  for (const owner of ALL_PROBLEM_OWNERS) {
    monaco.editor
      .getModelMarkers({ resource: model.uri, owner })
      .forEach((m, i) => out.push(toProblem(monaco, owner, m, i)));
  }
  return out.sort((a, b) => a.line - b.line || a.column - b.column);
}

export function problemCounts(problems: Problem[]): {
  errors: number;
  warnings: number;
  info: number;
} {
  let errors = 0;
  let warnings = 0;
  let info = 0;
  for (const p of problems) {
    if (p.severity === "error") errors++;
    else if (p.severity === "warning") warnings++;
    else info++;
  }
  return { errors, warnings, info };
}

/* -------------------------------------------------------------- pre-flight */

export interface PreflightResult {
  entry: MosEntry | null;
  problems: Problem[];
  /** the language service answered (false when it could not load) */
  checked: boolean;
}

/** Re-runs Ruff, the MOS rules and the catalog validation right now, so a submit sees exactly what is on screen. */
export async function runPreflight(
  monaco: MonacoNS,
  model: Monaco.editor.ITextModel,
  mission: Mission,
): Promise<PreflightResult> {
  const reg = ensureLanguage(monaco);
  let res = await reg.handle.checkNow(model).catch(() => null);
  if (!res) res = await reg.handle.checkNow(model).catch(() => null); // superseded by a typing-triggered check: ask again
  let catalog = reg.catalogs.get(mission);
  if (!catalog) {
    catalog = await loadCatalog(mission).catch(() => undefined);
    if (catalog) reg.catalogs.set(mission, catalog);
  }
  if (catalog) {
    // computed here (the provider debounces); published under the same owner so the Problems panel agrees
    monaco.editor.setModelMarkers(
      model,
      DIAGNOSTIC_OWNER,
      validateCatalogUsage(monaco, model, catalog),
    );
  }
  const entryState = reg.entries.get(model.uri.toString());
  const mosSyntax = res?.diagnostics.some((d) => d.code === "MOS000");
  return {
    entry: res ? (mosSyntax ? null : res.entry) : (entryState?.entry ?? null),
    problems: collectProblems(monaco, model),
    checked: !!res,
  };
}

/* ---------------------------------------------------------- model lifecycle */

const pendingDispose = new Map<string, ReturnType<typeof setTimeout>>();

/** Disposes a draft model shortly after its editor goes away, unless the editor comes back (Activity re-show). */
export function scheduleModelDisposal(
  monaco: MonacoNS,
  path: string,
  delayMs = 4000,
): void {
  cancelModelDisposal(path);
  pendingDispose.set(
    path,
    setTimeout(() => {
      pendingDispose.delete(path);
      monaco.editor.getModel(monaco.Uri.parse(path))?.dispose();
    }, delayMs),
  );
}

export function cancelModelDisposal(path: string): void {
  const t = pendingDispose.get(path);
  if (t) clearTimeout(t);
  pendingDispose.delete(path);
}
