/**
 * Monaco language features for the procedure editor, backed by workers/lang.worker.ts.
 *
 *   const handle = registerPythonLanguageFeatures(monaco, { client: getLangClient(), getMission: (m) => 'FF' });
 *   ...
 *   handle.dispose();
 *
 * Providers: completion (jedi), hover, signature help, definition (same file), quick fixes (Ruff fixes),
 * document formatting (ruff format).
 * Diagnostics: on content change (debounced) Ruff and the MOS checks run independently and publish
 * Monaco markers under the owners `ruff` and `mos` (Ruff does not wait for Pyodide).
 *
 * Problems panel: there is nothing extra to maintain; list `getProblems(monaco, model)` and re-render on
 * `onDidChangeProblems(monaco, cb)` (a thin wrapper over `monaco.editor.onDidChangeMarkers`).
 */
import type * as Monaco from 'monaco-editor';
import type { LangClient } from './lang-client';
import type {
  CompletionKind,
  LangCompletion,
  MosCheckResult,
  MosDiagnostic,
  MosEntry,
  Mission,
  RuffDiagnostic,
} from './lang-protocol';

type MonacoNS = typeof Monaco;

export const RUFF_OWNER = 'ruff';
export const MOS_OWNER = 'mos';
export const PROBLEM_OWNERS: readonly string[] = [RUFF_OWNER, MOS_OWNER];

export interface PythonLanguageOptions {
  client: LangClient;
  /** Mission of the procedure being edited (drives MOS008 and framework alias resolution). */
  getMission(model: Monaco.editor.ITextModel): Mission | null;
  /**
   * Return true when the catalog-driven provider owns completions at this position; jedi then stays silent.
   * Default: cursor after `<alias>.` where alias is `comm` / `param` / `cmd` or any alias bound to
   * `framework.<mission>.commands|parameters` in the file.
   */
  shouldDefer?(model: Monaco.editor.ITextModel, position: Monaco.Position): boolean;
  /** Optional enum names from the catalog so MOS004 can flag unknown enums. */
  getEnums?(mission: Mission | null): { commands: string[]; parameters: string[] } | undefined;
  /** Called after every MOS check with the parsed entry signature (null when the file has a syntax error). */
  onEntry?(model: Monaco.editor.ITextModel, entry: MosEntry | null, diagnostics: MosDiagnostic[]): void;
  /** Model language id, default 'python'. */
  languageId?: string;
  /** Diagnostics debounce, default 300 ms. */
  debounceMs?: number;
}

export interface PythonLanguageHandle extends Monaco.IDisposable {
  /** Re-run Ruff + MOS checks for a model right now (e.g. on save / before submitting for review). */
  checkNow(model: Monaco.editor.ITextModel): Promise<MosCheckResult | null>;
}

/* ------------------------------------------------------------------ problems */

/** Markers published by this module (Ruff + MOS) for a model, sorted by position. */
export function getProblems(monaco: MonacoNS, model: Monaco.editor.ITextModel): Monaco.editor.IMarker[] {
  return PROBLEM_OWNERS.flatMap((owner) => monaco.editor.getModelMarkers({ resource: model.uri, owner })).sort(
    (a, b) => a.startLineNumber - b.startLineNumber || a.startColumn - b.startColumn,
  );
}

/** Subscribe to marker changes of any model; `uris` are the resources that changed. */
export function onDidChangeProblems(monaco: MonacoNS, cb: (uris: readonly Monaco.Uri[]) => void): Monaco.IDisposable {
  return monaco.editor.onDidChangeMarkers(cb);
}

/* ----------------------------------------------------------------- utilities */

const DEFAULT_ALIASES = ['comm', 'param', 'cmd'];
const ALIAS_IMPORT_RE = /import\s+framework\.\w+\.(?:commands|parameters)\s+as\s+(\w+)/g;

function frameworkAliases(model: Monaco.editor.ITextModel): Set<string> {
  const aliases = new Set(DEFAULT_ALIASES);
  for (const m of model.getValue().matchAll(ALIAS_IMPORT_RE)) aliases.add(m[1]);
  return aliases;
}

function defaultShouldDefer(model: Monaco.editor.ITextModel, position: Monaco.Position): boolean {
  const before = model.getValueInRange({
    startLineNumber: position.lineNumber,
    startColumn: 1,
    endLineNumber: position.lineNumber,
    endColumn: position.column,
  });
  const m = /\b(\w+)\.\w*$/.exec(before);
  return !!m && frameworkAliases(model).has(m[1]);
}

function ruffSeverity(monaco: MonacoNS, code: string): Monaco.MarkerSeverity {
  const S = monaco.MarkerSeverity;
  if (code === 'invalid-syntax' || code.startsWith('E9')) return S.Error;
  if (/^F(821|822|823|63\d|70\d|50\d|60\d)/.test(code)) return S.Error; // undefined names, bad syntax-ish F rules
  if (code.startsWith('W') || code.startsWith('UP')) return S.Info;
  return S.Warning;
}

function mosSeverity(monaco: MonacoNS, s: MosDiagnostic['severity']): Monaco.MarkerSeverity {
  return s === 'error'
    ? monaco.MarkerSeverity.Error
    : s === 'warning'
      ? monaco.MarkerSeverity.Warning
      : monaco.MarkerSeverity.Info;
}

function completionKind(monaco: MonacoNS, k: CompletionKind): Monaco.languages.CompletionItemKind {
  const K = monaco.languages.CompletionItemKind;
  switch (k) {
    case 'module': return K.Module;
    case 'class': return K.Class;
    case 'function': return K.Function;
    case 'parameter': return K.Variable;
    case 'file': return K.File;
    case 'keyword': return K.Keyword;
    case 'property': return K.Property;
    default: return K.Variable;
  }
}

/** Strip a leading "name(sig)" line that jedi repeats at the top of docstrings. */
function stripSignature(doc: string, signature: string): string {
  const first = doc.split('\n', 1)[0];
  return signature && first.trim().startsWith(signature.split('(')[0]) && first.includes('(')
    ? doc.slice(first.length).trim()
    : doc;
}

function codeBlock(text: string): string {
  return '```python\n' + text + '\n```';
}

function toRange(d: { startLine: number; startColumn: number; endLine: number; endColumn: number }) {
  return {
    startLineNumber: d.startLine,
    startColumn: d.startColumn,
    endLineNumber: d.endLine,
    endColumn: d.endColumn,
  };
}

/* ---------------------------------------------------------------------- main */

interface ModelState {
  ruff: RuffDiagnostic[] | null;
  mos: MosCheckResult | null;
  timer: ReturnType<typeof setTimeout> | null;
  listener: Monaco.IDisposable;
}

export function registerPythonLanguageFeatures(monaco: MonacoNS, options: PythonLanguageOptions): PythonLanguageHandle {
  const { client, getMission } = options;
  const lang = options.languageId ?? 'python';
  const debounceMs = options.debounceMs ?? 300;
  const shouldDefer = options.shouldDefer ?? defaultShouldDefer;
  const disposables: Monaco.IDisposable[] = [];
  const states = new Map<string, ModelState>();
  let completionSeq = 0;

  /* ------------------------------------------------------------ diagnostics */

  const publish = (model: Monaco.editor.ITextModel, state: ModelState) => {
    if (model.isDisposed()) return;
    const ruffMarkers: Monaco.editor.IMarkerData[] = (state.ruff ?? []).map((d) => ({
      ...toRange(d),
      message: d.message,
      severity: ruffSeverity(monaco, d.code),
      code: d.code,
      source: 'Ruff',
      tags: d.tags.map((t) =>
        t === 'unnecessary' ? monaco.MarkerTag.Unnecessary : monaco.MarkerTag.Deprecated,
      ),
    }));
    monaco.editor.setModelMarkers(model, RUFF_OWNER, ruffMarkers);

    // Ruff already reports syntax errors with better ranges; do not show MOS000 twice.
    const ruffHasSyntaxError = (state.ruff ?? []).some((d) => d.code === 'invalid-syntax');
    const mosMarkers: Monaco.editor.IMarkerData[] = (state.mos?.diagnostics ?? [])
      .filter((d) => !(d.code === 'MOS000' && ruffHasSyntaxError))
      .map((d) => ({
        ...toRange(d),
        message: d.message,
        severity: mosSeverity(monaco, d.severity),
        code: d.code,
        source: 'MOS',
      }));
    monaco.editor.setModelMarkers(model, MOS_OWNER, mosMarkers);
  };

  const runChecks = async (model: Monaco.editor.ITextModel): Promise<MosCheckResult | null> => {
    const state = states.get(model.uri.toString());
    if (!state || model.isDisposed()) return null;
    const version = model.getVersionId();
    const code = model.getValue();
    const mission = getMission(model);
    const current = () => !model.isDisposed() && model.getVersionId() === version;

    const ruffP = client
      .check(code)
      .then((r) => {
        if (r && current()) {
          state.ruff = r;
          publish(model, state);
        }
      })
      .catch(() => undefined); // component load failures are visible through client.getStatus()
    const mosP = client
      .mosCheck(code, mission, options.getEnums?.(mission))
      .then((r) => {
        if (r && current()) {
          state.mos = r;
          publish(model, state);
          options.onEntry?.(model, r.diagnostics.some((d) => d.code === 'MOS000') ? null : r.entry, r.diagnostics);
        }
        return r;
      })
      .catch(() => null);
    const [, mos] = await Promise.all([ruffP, mosP]);
    return mos;
  };

  const attach = (model: Monaco.editor.ITextModel) => {
    if (model.getLanguageId() !== lang) return;
    const key = model.uri.toString();
    if (states.has(key)) return;
    const state: ModelState = {
      ruff: null,
      mos: null,
      timer: null,
      listener: model.onDidChangeContent(() => {
        if (state.timer) clearTimeout(state.timer);
        state.timer = setTimeout(() => void runChecks(model), debounceMs);
      }),
    };
    states.set(key, state);
    void runChecks(model);
  };

  const detach = (model: Monaco.editor.ITextModel) => {
    const key = model.uri.toString();
    const state = states.get(key);
    if (!state) return;
    if (state.timer) clearTimeout(state.timer);
    state.listener.dispose();
    states.delete(key);
    if (!model.isDisposed()) {
      monaco.editor.setModelMarkers(model, RUFF_OWNER, []);
      monaco.editor.setModelMarkers(model, MOS_OWNER, []);
    }
  };

  monaco.editor.getModels().forEach(attach);
  disposables.push(
    monaco.editor.onDidCreateModel(attach),
    monaco.editor.onWillDisposeModel(detach),
    monaco.editor.onDidChangeModelLanguage(({ model }) => (model.getLanguageId() === lang ? attach(model) : detach(model))),
  );

  /* ---------------------------------------------------------------- providers */

  disposables.push(
    monaco.languages.registerCompletionItemProvider(lang, {
      triggerCharacters: ['.'],
      async provideCompletionItems(model, position, _ctx, token) {
        if (shouldDefer(model, position)) return { suggestions: [] };
        if (!client.isReady('jedi')) {
          client.warmup();
          return { suggestions: [], incomplete: true };
        }
        const items = await client.complete(model.getValue(), position.lineNumber, position.column);
        if (!items || token.isCancellationRequested) return { suggestions: [] };
        const seq = ++completionSeq;
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };
        return {
          suggestions: items.map(
            (c: LangCompletion): Monaco.languages.CompletionItem & { _seq: number; _i: number } => ({
              label: c.label,
              kind: completionKind(monaco, c.kind),
              detail: c.detail,
              insertText: c.label,
              sortText: c.sort + c.label.toLowerCase(),
              range,
              _seq: seq,
              _i: c.i,
            }),
          ),
        };
      },
      async resolveCompletionItem(item) {
        const { _seq, _i } = item as Monaco.languages.CompletionItem & { _seq?: number; _i?: number };
        if (_seq !== completionSeq || _i === undefined) return item;
        const doc = await client.completeResolve(_i).catch(() => null);
        if (doc && (doc.signature || doc.doc)) {
          const parts = [];
          if (doc.signature) parts.push(codeBlock(doc.signature));
          const body = stripSignature(doc.doc, doc.signature);
          if (body) parts.push(body);
          item.documentation = { value: parts.join('\n\n') };
        }
        return item;
      },
    }),

    monaco.languages.registerHoverProvider(lang, {
      async provideHover(model, position, token) {
        if (!client.isReady('jedi')) return null;
        const h = await client.hover(model.getValue(), position.lineNumber, position.column).catch(() => null);
        if (!h || token.isCancellationRequested) return null;
        const word = model.getWordAtPosition(position);
        const contents: Monaco.IMarkdownString[] = [{ value: codeBlock(h.signature || h.description) }];
        const body = stripSignature(h.doc, h.signature);
        if (body) contents.push({ value: body });
        return {
          contents,
          range: word
            ? {
                startLineNumber: position.lineNumber,
                endLineNumber: position.lineNumber,
                startColumn: word.startColumn,
                endColumn: word.endColumn,
              }
            : undefined,
        };
      },
    }),

    monaco.languages.registerSignatureHelpProvider(lang, {
      signatureHelpTriggerCharacters: ['(', ','],
      signatureHelpRetriggerCharacters: [')'],
      async provideSignatureHelp(model, position, token) {
        if (!client.isReady('jedi')) return null;
        const sigs = await client.signature(model.getValue(), position.lineNumber, position.column).catch(() => null);
        if (!sigs || !sigs.length || token.isCancellationRequested) return null;
        const first = sigs[0];
        return {
          value: {
            signatures: sigs.map((s) => ({
              label: s.label,
              documentation: s.doc ? { value: stripSignature(s.doc, s.label) } : undefined,
              parameters: s.params.map((p) => ({ label: p })),
            })),
            activeSignature: 0,
            activeParameter: Math.min(first.activeParameter, Math.max(first.params.length - 1, 0)),
          },
          dispose() {},
        };
      },
    }),

    monaco.languages.registerDefinitionProvider(lang, {
      async provideDefinition(model, position, token) {
        if (!client.isReady('jedi')) return null;
        const defs = await client.definition(model.getValue(), position.lineNumber, position.column).catch(() => null);
        if (!defs || token.isCancellationRequested) return null;
        return defs.map((d) => ({ uri: model.uri, range: toRange(d) }));
      },
    }),

    monaco.languages.registerDocumentFormattingEditProvider(lang, {
      displayName: 'Ruff',
      async provideDocumentFormattingEdits(model) {
        const res = await client.format(model.getValue()).catch(() => null); // syntax errors: leave the text alone
        if (!res || res.code === model.getValue()) return [];
        return [{ range: model.getFullModelRange(), text: res.code }];
      },
    }),

    monaco.languages.registerCodeActionProvider(lang, {
      provideCodeActions(model, _range, context) {
        const state = states.get(model.uri.toString());
        if (!state?.ruff) return { actions: [], dispose() {} };
        const actions: Monaco.languages.CodeAction[] = [];
        for (const marker of context.markers) {
          if (marker.source !== 'Ruff') continue;
          const code = typeof marker.code === 'string' ? marker.code : marker.code?.value;
          const diag = state.ruff.find(
            (d) => d.code === code && d.startLine === marker.startLineNumber && d.startColumn === marker.startColumn,
          );
          if (!diag?.fix) continue;
          actions.push({
            title: diag.fix.message ? `Ruff: ${diag.fix.message}` : `Ruff: fix ${diag.code}`,
            kind: 'quickfix',
            diagnostics: [marker],
            isPreferred: true,
            edit: {
              edits: diag.fix.edits.map((e) => ({
                resource: model.uri,
                versionId: model.getVersionId(),
                textEdit: { range: toRange(e), text: e.content },
              })),
            },
          });
        }
        return { actions, dispose() {} };
      },
    }),
  );

  return {
    checkNow: (model) => {
      const st = states.get(model.uri.toString());
      if (st?.timer) clearTimeout(st.timer);
      return runChecks(model);
    },
    dispose() {
      for (const model of monaco.editor.getModels()) detach(model);
      for (const d of disposables) d.dispose();
      disposables.length = 0;
    },
  };
}
