import type { MosRole, SnapshotAction, SnapshotState } from "@/lib/lifecycle";

export type Mission = "FF" | "JTYU";

export interface Profile {
  id: string;
  email: string;
  display_name: string;
  initials: string;
  color: string;
  title: string | null;
  roles: MosRole[];
}

export interface ProcedureOverview {
  id: string;
  name: string;
  description: string;
  mission: Mission;
  folder: string;
  created_by: string;
  created_at: string;
  retired_at: string | null;
  retired_reason: string | null;
  snapshot_seq: number;
  active_snapshot_id: string | null;
  active_number: number | null;
  active_sha256: string | null;
  active_since: string | null;
  working_copies: number;
  in_review: number;
  in_test: number;
  awaiting_approval: number;
  total_snapshots: number;
  last_activity_at: string;
}

export interface SnapshotRow {
  id: string;
  procedure_id: string;
  number: number;
  author_id: string;
  parent_snapshot_id: string | null;
  state: SnapshotState;
  draft_path: string;
  code_path: string | null;
  code_sha256: string | null;
  code_bytes: number | null;
  entrypoint: string | null;
  signature: ProcedureSignature | null;
  summary: string | null;
  submitted_at: string | null;
  superseded_by_snapshot_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SnapshotListRow {
  id: string;
  procedure_id: string;
  procedure_name: string;
  mission: Mission;
  folder: string;
  procedure_retired_at: string | null;
  number: number;
  state: SnapshotState;
  summary: string | null;
  code_sha256: string | null;
  entrypoint: string | null;
  parent_snapshot_id: string | null;
  parent_number: number | null;
  author_id: string;
  author_name: string;
  author_initials: string;
  author_color: string;
  created_at: string;
  submitted_at: string | null;
  updated_at: string;
  state_changed_at: string | null;
  is_active: boolean;
}

export interface TransitionRow {
  id: number;
  snapshot_id: string;
  procedure_id: string;
  action: SnapshotAction;
  from_state: SnapshotState | null;
  to_state: SnapshotState;
  actor_id: string;
  comment: string | null;
  related_snapshot_id: string | null;
  evidence: Record<string, unknown>;
  created_at: string;
}

export interface ProcedureEventRow {
  id: number;
  procedure_id: string;
  kind: "created" | "retired" | "restored" | "working_copy_discarded";
  actor_id: string;
  reason: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface ReviewComment {
  id: string;
  snapshot_id: string;
  author_id: string;
  line: number | null;
  body: string;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
}

export interface TestRecord {
  id: string;
  snapshot_id: string;
  tester_id: string;
  name: string;
  result: "pass" | "fail" | "blocked";
  notes: string;
  run_id: string | null;
  created_at: string;
}

export type RunOutcome = "running" | "completed" | "skipped" | "stopped" | "choose" | "error";

export interface RunRow {
  id: string;
  snapshot_id: string;
  target: "mock" | "bifrost";
  code_sha256: string | null;
  args: Record<string, unknown>;
  options: Record<string, unknown>;
  outcome: RunOutcome;
  error: string | null;
  events: unknown[];
  summary: { commands?: number; tmChecks?: number; prompts?: number; virtualSeconds?: number; wallMs?: number; warnings?: number; errors?: number };
  bifrost_sim_id: string | null;
  started_by: string;
  started_at: string;
  ended_at: string | null;
}

export interface SignatureParam {
  name: string;
  annotation: string;
  kind: "str" | "int" | "float" | "bool" | "list" | "datetime" | "enum" | "any";
  enum?: string;
  default?: unknown;
}

export interface ProcedureSignature {
  entrypoint: string;
  params: SignatureParam[];
}
