/**
 * Message protocol between lib/editor/lang-client.ts and workers/lang.worker.ts.
 * Request: `{ id, ...LangRequest }`  ->  Response: `{ id, ok: true, result } | { id, ok: false, error, cancelled? }`.
 * The worker also pushes unsolicited `{ event: 'status', status }` messages.
 *
 * Positions: `line` and `column` are Monaco-style (1-based line, 1-based column) in every request and
 * every result range; the worker converts to jedi's 0-based columns internally.
 */

export type Mission = 'FF' | 'JTYU';

export type ComponentState = 'idle' | 'loading' | 'ready' | 'error';

export interface LangStatus {
  ruff: ComponentState;
  /** Pyodide core + the mos_lint package (enough for `mosCheck`). */
  python: ComponentState;
  /** jedi + parso + framework shim loaded (enough for complete/hover/signature/definition). */
  jedi: ComponentState;
  errors: { ruff?: string; python?: string; jedi?: string };
  /** Non-fatal notes, e.g. "framework shim not found: running jedi without framework stubs". */
  notes: string[];
}

export interface Range {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface RuffEdit extends Range {
  content: string;
}

export interface RuffDiagnostic extends Range {
  /** Rule code (`F401`, `E722`...), or `invalid-syntax` for parse errors. */
  code: string;
  message: string;
  tags: ('unnecessary' | 'deprecated')[];
  fix: { message: string | null; edits: RuffEdit[] } | null;
}

export type MosSeverity = 'error' | 'warning' | 'info';

export interface MosDiagnostic extends Range {
  code: string; // MOS000..MOS009
  severity: MosSeverity;
  message: string;
}

export type ParamKind = 'str' | 'int' | 'float' | 'bool' | 'datetime' | 'list' | 'enum' | 'unknown';

export interface MosParam {
  name: string;
  /** Annotation source text, null when missing. */
  annotation: string | null;
  kind: ParamKind;
  position: 'positional' | 'keyword_only';
  required: boolean;
  /** kind === 'list': element descriptor (absent for bare `list`). */
  item?: { kind: ParamKind; enum?: string; enumModule?: 'commands' | 'parameters'; item?: unknown };
  /** kind === 'enum' */
  enum?: string;
  enumModule?: 'commands' | 'parameters';
  mission?: string;
  /** Literal default (JSON value). */
  default?: unknown;
  /** Non-literal default, as source text. */
  defaultExpr?: string;
}

export interface MosEntry {
  /** First public top-level function; null if none or the file has a syntax error. */
  entrypoint: string | null;
  params: MosParam[];
  line?: number;
  isAsync?: boolean;
  doc?: string;
}

export interface MosCheckResult {
  diagnostics: MosDiagnostic[];
  entry: MosEntry;
}

export type CompletionKind =
  | 'module' | 'class' | 'variable' | 'function' | 'parameter' | 'file' | 'keyword' | 'property';

export interface LangCompletion {
  /** Index into the worker's last completion list; pass to `completeResolve`. */
  i: number;
  label: string;
  kind: CompletionKind;
  detail: string;
  /** 'a' normal, 'y' _private, 'z' dunder. */
  sort: 'a' | 'y' | 'z';
}

export interface LangCompletionDoc {
  signature: string;
  doc: string;
}

export interface LangHover {
  name: string;
  type: string;
  fullName: string | null;
  description: string;
  signature: string;
  doc: string;
}

export interface LangSignature {
  label: string;
  doc: string;
  activeParameter: number;
  params: string[];
}

export type LangRequest =
  | { type: 'warmup' }
  | { type: 'status' }
  | { type: 'check'; code: string }
  | { type: 'format'; code: string }
  | { type: 'mosCheck'; code: string; mission: Mission | null; enums?: { commands: string[]; parameters: string[] } }
  | { type: 'complete'; code: string; line: number; column: number }
  | { type: 'completeResolve'; index: number }
  | { type: 'hover'; code: string; line: number; column: number }
  | { type: 'signature'; code: string; line: number; column: number }
  | { type: 'definition'; code: string; line: number; column: number };

export type LangRequestType = LangRequest['type'];

export interface LangResultMap {
  warmup: LangStatus;
  status: LangStatus;
  check: RuffDiagnostic[];
  format: { code: string };
  mosCheck: MosCheckResult;
  complete: LangCompletion[];
  completeResolve: LangCompletionDoc;
  hover: LangHover | null;
  signature: LangSignature[];
  definition: Range[];
}

export type LangResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string; cancelled?: boolean };

export type LangEvent = { event: 'status'; status: LangStatus };

export const RUFF_VENDOR_BASE = '/vendor/ruff/';
export const PYODIDE_BASE = '/vendor/pyodide/';
export const PY_BASE = '/py/';
