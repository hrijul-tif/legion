/** Shapes of the seed manifest (what the demo data looks like) and of the rows the replay produces. */
import type { Fault } from "../lib/sandbox/types";
import type { Signature } from "./harness";

export type PersonaKey = "asha" | "rohan" | "meera" | "kabir" | "nisha" | "dev";

/** Time before "now" the step happened, e.g. "41d 20h", "5h", "2d 3h 15m". Larger = earlier. */
export type Ago = string;

/** "main" = the procedure's file in seed/procedures/ff/<folder>/, "v2" = seed/procedures/ff/_versions/<name>.v2.py */
export type CodeRef = string;

/** A dry run executed for real in Node Pyodide while seeding (or while testing the seeds). */
export interface RunSpec {
  /** merged over the procedure's defaultArgs */
  args?: Record<string, unknown>;
  faults?: Fault[];
  /** prompt answers in order; further prompts get "5: Stop execution" */
  answers?: string[];
  /** telemetry overrides applied at t=0 */
  telemetry?: Record<string, unknown>;
}

export type ManualOp = "review_pass" | "review_fail" | "test_pass" | "test_fail" | "retest" | "approve" | "refuse" | "send_back" | "reactivate" | "withdraw";

export type Step =
  /** A working copy (#n = next number). The first `create` also creates the procedure. `code` is what this snapshot ends up containing. */
  | { op: "create"; by: PersonaKey; ago: Ago; from?: number; code: CodeRef }
  | { op: "submit"; n: number; ago: Ago; summary: string }
  | { op: ManualOp; n: number; by: PersonaKey; ago: Ago; comment?: string }
  | {
      op: "comment";
      n: number;
      by: PersonaKey;
      ago: Ago;
      body: string;
      /** line is found by searching the snapshot's code for this text (nth occurrence, default 1); omit for a general comment */
      anchor?: { text: string; nth?: number };
      resolved?: { by: PersonaKey; ago: Ago };
    }
  | { op: "test"; n: number; by: PersonaKey; ago: Ago; name: string; result: "pass" | "fail" | "blocked"; notes: string; run?: RunSpec }
  | { op: "run"; n: number; by: PersonaKey; ago: Ago; run?: RunSpec }
  | { op: "retire" | "restore"; by: PersonaKey; ago: Ago; reason: string };

export interface ProcedureSeed {
  /** FF sheet-style name == file stem */
  name: string;
  mission: "FF";
  /** subsystem/kind folder as in ff-procedures, e.g. "EPS/FCP" */
  folder: string;
  description: string;
  /** path of the main code file relative to seed/ */
  file: string;
  /** default dry-run arguments (every snapshot of the procedure must run to `completed` with these on the mock) */
  defaultArgs: Record<string, unknown>;
  history: Step[];
}

/* ------------------------------------------------------------------ replay output (rows with emails instead of user ids) */

export type SnapshotState =
  | "in_progress"
  | "ready_for_review"
  | "review_failed"
  | "test_in_progress"
  | "test_failed"
  | "approval_pending"
  | "approval_failed"
  | "approved"
  | "superseded"
  | "withdrawn";

export interface ProcedureOut {
  id: string;
  name: string;
  description: string;
  mission: string;
  folder: string;
  active_snapshot_id: string | null;
  snapshot_seq: number;
  retired_at: string | null;
  retired_by: string | null; // email
  retired_reason: string | null;
  created_by: string; // email
  created_at: string;
}

export interface SnapshotOut {
  id: string;
  procedure_id: string;
  number: number;
  author: string; // email
  parent_snapshot_id: string | null;
  state: SnapshotState;
  draft_path: string;
  code_path: string | null;
  code_sha256: string | null;
  code_bytes: number | null;
  entrypoint: string | null;
  signature: Signature | null;
  summary: string | null;
  submitted_at: string | null;
  superseded_by_snapshot_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface TransitionOut {
  snapshot_id: string;
  procedure_id: string;
  action: string;
  from_state: SnapshotState | null;
  to_state: SnapshotState;
  actor: string; // email
  comment: string | null;
  related_snapshot_id: string | null;
  evidence: Record<string, unknown>;
  created_at: string;
}

export interface ProcedureEventOut {
  procedure_id: string;
  kind: "created" | "retired" | "restored" | "working_copy_discarded";
  actor: string;
  reason: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface CommentOut {
  id: string;
  snapshot_id: string;
  author: string;
  line: number | null;
  body: string;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
}

export interface TestOut {
  id: string;
  snapshot_id: string;
  tester: string;
  name: string;
  result: "pass" | "fail" | "blocked";
  notes: string;
  run_id: string | null;
  created_at: string;
}

export interface RunOut {
  id: string;
  snapshot_id: string;
  target: "mock";
  code_sha256: string;
  args: Record<string, unknown>;
  options: Record<string, unknown>;
  outcome: string;
  error: string | null;
  events: unknown[];
  summary: Record<string, number>;
  started_by: string;
  started_at: string;
  ended_at: string;
}

export interface CodeObject {
  path: string;
  text: string;
  kind: "draft" | "frozen";
}

export interface ReplayOutput {
  now: string;
  procedures: ProcedureOut[];
  snapshots: SnapshotOut[];
  /** chronological (ties keep logical order: supersede row before the approve that caused it) */
  transitions: TransitionOut[];
  events: ProcedureEventOut[];
  comments: CommentOut[];
  tests: TestOut[];
  runs: RunOut[];
  codes: CodeObject[];
}
