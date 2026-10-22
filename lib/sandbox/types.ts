/** Shared types of the procedure sandbox (run worker <-> client <-> UI). Contract: see the shared CONTRACTS.md. */

export type Mission = 'FF' | 'JTYU';

export type Fault =
  | { kind: 'command_fails'; match?: string; once: boolean }
  | { kind: 'command_timeout'; match?: string; once: boolean }
  | { kind: 'freeze_param'; q: string }
  | { kind: 'drop_param'; q: string };

export type Outcome = 'completed' | 'skipped' | 'stopped' | 'choose' | 'error';

/** Every event carries `t` (virtual seconds since run start) and `wall` (Date.now()). */
interface Timed {
  t: number;
  wall: number;
}

export interface LogEvent extends Timed {
  type: 'log';
  level: 'debug' | 'info' | 'warning' | 'error';
  msg: string;
  /** 'run' (run_logger), 'extra' (bus logger), 'csv' (csv_logger, duplicates run messages), 'sim' (mock spacecraft notes) */
  logger?: 'run' | 'extra' | 'csv' | 'sim';
}
export interface StdoutEvent extends Timed {
  type: 'stdout';
  /** one printed line (no trailing newline) */
  text: string;
  stream?: 'stderr';
}
export interface CommandEvent extends Timed {
  type: 'command';
  q: string;
  cls: string;
  args: Record<string, unknown>;
  status: 'issued' | 'completed' | 'failed' | 'timeout';
  error?: string;
}
export interface TmEvent extends Timed {
  type: 'tm';
  q: string;
  cls: string | null;
  value: unknown;
  fresh: boolean;
}
export interface PromptEvent extends Timed {
  type: 'prompt';
  id: string;
  message: string;
  choices: string[];
}
export interface TelemetryEvent extends Timed {
  type: 'telemetry';
  values: Record<string, unknown>;
}
export interface DoneEvent extends Timed {
  type: 'done';
  outcome: Outcome;
  error?: string;
  traceback?: string;
  returnValue?: string;
  virtualSeconds: number;
  wallMs: number;
}

export type RunEvent = LogEvent | StdoutEvent | CommandEvent | TmEvent | PromptEvent | TelemetryEvent | DoneEvent;

export interface RunOptions {
  /** virtual seconds per real second: 1, 10, 100, Infinity (no real waiting) */
  warp: number;
  faults: Fault[];
  /** seed of the deterministic command-latency RNG (default 1) */
  seed?: number;
  /** inline sim file instead of fetching /sim/<mission>-sim.json (same format as public/sim/README.md) */
  sim?: Record<string, unknown>;
  /** telemetry overrides applied at t=0 (the client also re-applies overrides set through setTelemetry) */
  telemetry?: Record<string, unknown>;
}

export interface RunRequest {
  runId?: string;
  code: string;
  /** function to call; default: the single public top-level function */
  entrypoint?: string;
  /** values as typed in the args form; converted by the entrypoint's annotations */
  args: Record<string, unknown>;
  mission: Mission;
  options: RunOptions;
}

export type ArgKind = 'str' | 'int' | 'float' | 'bool' | 'list' | 'datetime' | 'enum' | 'any';

export interface SignatureParam {
  name: string;
  /** annotation source text, e.g. "comm.PusAckFlagsEnum" */
  annotation: string | null;
  kind: ArgKind;
  required: boolean;
  optional: boolean;
  enum?: string;
  members?: { name: string; value: string | number }[];
  /** literal default */
  default?: unknown;
  /** source text of a non-literal default */
  defaultExpr?: string;
}

export interface SignatureResult {
  type: 'signature';
  entrypoint: string | null;
  params: SignatureParam[];
  /** public top-level functions */
  candidates: string[];
  error?: string;
}

/** Why the sandbox cannot run (e.g. missing COOP/COEP headers). */
export class SandboxUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SandboxUnavailableError';
  }
}

/* ---------------------------- internal worker protocol ---------------------------- */

export interface SharedBuffers {
  /** 1 byte used: write 2 (SIGINT) to interrupt the running Python */
  interrupt: SharedArrayBuffer;
  /** Int32 words: see CTL */
  ctl: SharedArrayBuffer;
  /** newline-delimited JSON control messages, length in ctl[CTL.MAIL_LEN] */
  mailbox: SharedArrayBuffer;
}

export const CTL = {
  /** prompt answer: 0 = none, otherwise choice index + 1 */
  PROMPT: 0,
  /** spin lock protecting the mailbox (0 free, 1 held) */
  LOCK: 1,
  /** bytes used in the mailbox */
  MAIL_LEN: 2,
  /** always 0; Atomics.wait target for sleeping */
  SLEEP: 3,
} as const;
export const CTL_WORDS = 4;
export const MAILBOX_BYTES = 256 * 1024;

export type ToWorker =
  | { type: 'init'; buffers: SharedBuffers }
  | { type: 'run'; runId: string; req: RunRequest }
  | { type: 'inspect'; reqId: number; code: string; mission: Mission; entrypoint?: string };

export type FromWorker =
  | { type: 'ready' }
  | { type: 'fatal'; message: string }
  | { type: 'events'; runId: string; events: RunEvent[] }
  | { type: 'signature'; reqId: number; result: SignatureResult };
