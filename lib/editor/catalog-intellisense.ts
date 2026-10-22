// Monaco glue for catalog-aware Python intellisense (completion, hover, signature help, diagnostics,
// quick fixes). All logic lives in catalog-analysis.ts; this file only adapts it to Monaco and never
// imports monaco at runtime (the namespace is passed in).

import type * as Monaco from 'monaco-editor';
import type { Catalog } from '../catalog/types';
import {
  DIAGNOSTIC_OWNER,
  analyze,
  getCompletions,
  getHover,
  getSignature,
  validateAnalysis,
  type Analysis,
  type CompletionSpec,
} from './catalog-analysis';

export { DIAGNOSTIC_OWNER } from './catalog-analysis';
export {
  detectAliases,
  detectImportedNames,
  validateSource,
  type CatalogDiagnostic,
} from './catalog-analysis';

export interface CatalogIntellisenseOptions {
  /** Catalog to use for a given document (undefined while loading / for non-MOS documents). */
  getCatalog: (model: Monaco.editor.ITextModel) => Catalog | undefined;
}

export interface CatalogIntellisenseHandle extends Monaco.IDisposable {
  /** Re-run diagnostics on every python model (call after the catalog finished loading). */
  revalidate(): void;
}

const VALIDATE_DEBOUNCE_MS = 250;

// ---------------------------------------------------------------------------------------------
// Analysis cache (per model version)

interface CacheEntry {
  version: number;
  catalog: Catalog;
  analysis: Analysis;
}
const analysisCache = new WeakMap<Monaco.editor.ITextModel, CacheEntry>();

function getAnalysis(model: Monaco.editor.ITextModel, catalog: Catalog): Analysis {
  const version = model.getVersionId();
  const hit = analysisCache.get(model);
  if (hit && hit.version === version && hit.catalog === catalog) return hit.analysis;
  const analysis = analyze(model.getValue(), catalog);
  analysisCache.set(model, { version, catalog, analysis });
  return analysis;
}

// ---------------------------------------------------------------------------------------------
// Diagnostics

/** Diagnostics for a model as Monaco markers (owner `mos-catalog`, see DIAGNOSTIC_OWNER). */
export function validateCatalogUsage(
  monaco: typeof Monaco,
  model: Monaco.editor.ITextModel,
  catalog: Catalog,
): Monaco.editor.IMarkerData[] {
  const analysis = getAnalysis(model, catalog);
  return validateAnalysis(analysis).map((d) => ({
    severity: d.severity === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
    message: d.message,
    code: d.code,
    source: DIAGNOSTIC_OWNER,
    startLineNumber: d.startLineNumber,
    startColumn: d.startColumn,
    endLineNumber: d.endLineNumber,
    endColumn: d.endColumn,
  }));
}

// ---------------------------------------------------------------------------------------------
// Registration

type CompletionItemWithSpec = Monaco.languages.CompletionItem & { __mos?: CompletionSpec };

export function registerCatalogIntellisense(
  monaco: typeof Monaco,
  opts: CatalogIntellisenseOptions,
): CatalogIntellisenseHandle {
  const LANG = 'python';
  const K = monaco.languages.CompletionItemKind;
  const disposables: Monaco.IDisposable[] = [];

  const rangeOf = (model: Monaco.editor.ITextModel, start: number, end: number): Monaco.IRange => {
    const s = model.getPositionAt(start);
    const e = model.getPositionAt(end);
    return { startLineNumber: s.lineNumber, startColumn: s.column, endLineNumber: e.lineNumber, endColumn: e.column };
  };

  const kindOf = (k: CompletionSpec['kind']): Monaco.languages.CompletionItemKind => {
    switch (k) {
      case 'class':
        return K.Class;
      case 'enum':
        return K.Enum;
      case 'member':
        return K.EnumMember;
      case 'kwarg':
        return K.Property;
      case 'value':
        return K.Value;
      case 'method':
        return K.Method;
      case 'module':
        return K.Module;
    }
  };

  // --- completion ---------------------------------------------------------------------------
  disposables.push(
    monaco.languages.registerCompletionItemProvider(LANG, {
      triggerCharacters: ['.', '(', ',', ' ', '='],
      provideCompletionItems(model, position) {
        const catalog = opts.getCatalog(model);
        if (!catalog) return { suggestions: [] };
        const analysis = getAnalysis(model, catalog);
        const specs = getCompletions(analysis, model.getOffsetAt(position));
        if (!specs || specs.length === 0) return { suggestions: [] };

        const rangeCache = new Map<string, Monaco.languages.CompletionItemRanges>();
        const suggestions = specs.map((spec): CompletionItemWithSpec => {
          const key = `${spec.start}:${spec.insertEnd}:${spec.replaceEnd}`;
          let range = rangeCache.get(key);
          if (!range) {
            range = {
              insert: rangeOf(model, spec.start, spec.insertEnd),
              replace: rangeOf(model, spec.start, spec.replaceEnd),
            };
            rangeCache.set(key, range);
          }
          const item: CompletionItemWithSpec = {
            label: spec.label,
            kind: kindOf(spec.kind),
            insertText: spec.insertText,
            detail: spec.detail,
            sortText: spec.sortText,
            filterText: spec.filterText,
            range,
            insertTextRules: spec.snippet ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
            command: spec.retrigger ? { id: 'editor.action.triggerSuggest', title: 'Suggest values' } : undefined,
          };
          if (spec.documentation) item.documentation = { value: spec.documentation };
          if (spec.lazyDocumentation) item.__mos = spec;
          return item;
        });
        return { suggestions };
      },
      resolveCompletionItem(item) {
        const spec = (item as CompletionItemWithSpec).__mos;
        if (spec?.lazyDocumentation && !item.documentation) item.documentation = { value: spec.lazyDocumentation() };
        return item;
      },
    }),
  );

  // --- hover --------------------------------------------------------------------------------
  disposables.push(
    monaco.languages.registerHoverProvider(LANG, {
      provideHover(model, position) {
        const catalog = opts.getCatalog(model);
        if (!catalog) return null;
        const h = getHover(getAnalysis(model, catalog), model.getOffsetAt(position));
        if (!h) return null;
        return { range: rangeOf(model, h.start, h.end), contents: [{ value: h.markdown }] };
      },
    }),
  );

  // --- signature help -----------------------------------------------------------------------
  disposables.push(
    monaco.languages.registerSignatureHelpProvider(LANG, {
      signatureHelpTriggerCharacters: ['(', ','],
      signatureHelpRetriggerCharacters: ['=', ' '],
      provideSignatureHelp(model, position) {
        const catalog = opts.getCatalog(model);
        if (!catalog) return null;
        const sig = getSignature(getAnalysis(model, catalog), model.getOffsetAt(position));
        if (!sig) return null;
        return {
          value: {
            signatures: [
              {
                label: sig.label,
                documentation: { value: sig.documentation },
                parameters: sig.parameters.map((p) => ({ label: p.label, documentation: { value: p.documentation } })),
                activeParameter: sig.activeParameter,
              },
            ],
            activeSignature: 0,
            activeParameter: sig.activeParameter,
          },
          dispose() {},
        };
      },
    }),
  );

  // --- quick fixes --------------------------------------------------------------------------
  disposables.push(registerCatalogQuickFixes(monaco, opts));

  // --- diagnostics --------------------------------------------------------------------------
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const modelListeners = new Map<string, Monaco.IDisposable>();

  const validate = (model: Monaco.editor.ITextModel) => {
    if (model.isDisposed()) return;
    const catalog = model.getLanguageId() === LANG ? opts.getCatalog(model) : undefined;
    monaco.editor.setModelMarkers(model, DIAGNOSTIC_OWNER, catalog ? validateCatalogUsage(monaco, model, catalog) : []);
  };

  const schedule = (model: Monaco.editor.ITextModel, delay = VALIDATE_DEBOUNCE_MS) => {
    const key = model.uri.toString();
    const t = timers.get(key);
    if (t) clearTimeout(t);
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        validate(model);
      }, delay),
    );
  };

  const attach = (model: Monaco.editor.ITextModel) => {
    const key = model.uri.toString();
    if (modelListeners.has(key)) return;
    const subs = [
      model.onDidChangeContent(() => schedule(model)),
      model.onDidChangeLanguage(() => schedule(model, 0)),
    ];
    modelListeners.set(key, { dispose: () => subs.forEach((s) => s.dispose()) });
    schedule(model, 0);
  };

  const detach = (model: Monaco.editor.ITextModel) => {
    const key = model.uri.toString();
    const t = timers.get(key);
    if (t) clearTimeout(t);
    timers.delete(key);
    modelListeners.get(key)?.dispose();
    modelListeners.delete(key);
    monaco.editor.setModelMarkers(model, DIAGNOSTIC_OWNER, []);
  };

  monaco.editor.getModels().forEach(attach);
  disposables.push(monaco.editor.onDidCreateModel(attach), monaco.editor.onWillDisposeModel(detach));

  return {
    revalidate() {
      monaco.editor.getModels().forEach((m) => schedule(m, 0));
    },
    dispose() {
      disposables.forEach((d) => d.dispose());
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
      modelListeners.forEach((l) => l.dispose());
      modelListeners.clear();
      monaco.editor.getModels().forEach((m) => monaco.editor.setModelMarkers(m, DIAGNOSTIC_OWNER, []));
    },
  };
}

/**
 * "Replace with <closest>" quick fixes for catalog diagnostics (unknown class / argument / enum member
 * and invalid raw enum values). Registered automatically by registerCatalogIntellisense; exported for reuse.
 */
export function registerCatalogQuickFixes(monaco: typeof Monaco, opts: CatalogIntellisenseOptions): Monaco.IDisposable {
  return monaco.languages.registerCodeActionProvider('python', {
    provideCodeActions(model, _range, context) {
      const catalog = opts.getCatalog(model);
      if (!catalog) return { actions: [], dispose() {} };
      const mine = context.markers.filter((m) => m.source === DIAGNOSTIC_OWNER);
      if (mine.length === 0) return { actions: [], dispose() {} };
      const diags = validateAnalysis(getAnalysis(model, catalog));
      const actions: Monaco.languages.CodeAction[] = [];
      for (const marker of mine) {
        const d = diags.find(
          (x) =>
            x.code === marker.code &&
            x.startLineNumber === marker.startLineNumber &&
            x.startColumn === marker.startColumn &&
            x.endLineNumber === marker.endLineNumber &&
            x.endColumn === marker.endColumn,
        );
        if (!d?.fixes) continue;
        d.fixes.forEach((text, i) => {
          actions.push({
            title: `Replace with ${text}`,
            kind: 'quickfix',
            diagnostics: [marker],
            isPreferred: i === 0,
            edit: {
              edits: [
                {
                  resource: model.uri,
                  versionId: model.getVersionId(),
                  textEdit: {
                    range: {
                      startLineNumber: marker.startLineNumber,
                      startColumn: marker.startColumn,
                      endLineNumber: marker.endLineNumber,
                      endColumn: marker.endColumn,
                    },
                    text,
                  },
                },
              ],
            },
          });
        });
      }
      return { actions, dispose() {} };
    },
  });
}
