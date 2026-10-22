// Mirror of the lifecycle rules in supabase/migrations/*_core_schema.sql (public.transition_snapshot).
// The database is the authority; this file drives labels, colours and which buttons the UI offers.

export const SNAPSHOT_STATES = [
  "in_progress",
  "ready_for_review",
  "review_failed",
  "test_in_progress",
  "test_failed",
  "approval_pending",
  "approval_failed",
  "approved",
  "superseded",
  "withdrawn",
] as const;
export type SnapshotState = (typeof SNAPSHOT_STATES)[number];

export type MosRole = "author" | "reviewer" | "tester" | "approver" | "admin";
export const ROLES: MosRole[] = ["author", "reviewer", "tester", "approver", "admin"];

export type Tone = "neutral" | "info" | "progress" | "warn" | "success" | "danger" | "muted";

export interface StateMeta {
  code: string; // PRD numbering
  label: string;
  short: string;
  tone: Tone;
  env: "DEV" | "TEST" | "PROD" | null; // where this snapshot "is" (PRD-002 R11)
  terminal: boolean;
  description: string;
}

export const STATE_META: Record<SnapshotState, StateMeta> = {
  in_progress: {
    code: "1",
    label: "In Progress",
    short: "Working copy",
    tone: "neutral",
    env: "DEV",
    terminal: false,
    description: "A working copy. Only its author can edit it; nothing about it affects anything else.",
  },
  ready_for_review: {
    code: "2",
    label: "Ready for Review",
    short: "In review",
    tone: "info",
    env: "TEST",
    terminal: false,
    description: "Frozen and submitted. Waiting for a reviewer to pass or fail the code.",
  },
  review_failed: {
    code: "3b",
    label: "Review Failed",
    short: "Review failed",
    tone: "danger",
    env: null,
    terminal: true,
    description: "The reviewer failed it. A snapshot never changes, so the fix is a new snapshot.",
  },
  test_in_progress: {
    code: "3a",
    label: "Review Passed, Test in Progress",
    short: "In test",
    tone: "progress",
    env: "TEST",
    terminal: false,
    description: "Review passed. A tester is running it against the simulator or flatsat.",
  },
  test_failed: {
    code: "4b",
    label: "Test Failed",
    short: "Test failed",
    tone: "danger",
    env: null,
    terminal: false,
    description: "The tester recorded a failure. It can be retested without a new submission.",
  },
  approval_pending: {
    code: "4a",
    label: "Tests Passed, Awaiting Approval",
    short: "Awaiting approval",
    tone: "warn",
    env: "TEST",
    terminal: false,
    description: "Reviewed and tested. Waiting for an approver to clear it for flight.",
  },
  approval_failed: {
    code: "5b",
    label: "Approval Failed",
    short: "Approval refused",
    tone: "danger",
    env: null,
    terminal: false,
    description: "The approver refused it. They can send it back for retesting with new cases.",
  },
  approved: {
    code: "5a",
    label: "Approved",
    short: "Active",
    tone: "success",
    env: "PROD",
    terminal: false,
    description: "The active snapshot. This is exactly what PROD runs.",
  },
  superseded: {
    code: "5c",
    label: "Superseded",
    short: "Superseded",
    tone: "muted",
    env: null,
    terminal: false,
    description: "Was approved; a newer snapshot took over. An approver can reactivate it (rollback).",
  },
  withdrawn: {
    code: "5d",
    label: "Withdrawn",
    short: "Withdrawn",
    tone: "muted",
    env: null,
    terminal: false,
    description: "Approval was removed. An approver can reactivate it without a review cycle.",
  },
};

export type ManualAction =
  | "review_pass"
  | "review_fail"
  | "test_pass"
  | "test_fail"
  | "retest"
  | "approve"
  | "refuse"
  | "send_back"
  | "reactivate"
  | "withdraw";
export type SnapshotAction = ManualAction | "create" | "submit" | "supersede";

export interface ActionMeta {
  label: string;
  verb: string; // past tense for the audit trail
  from: SnapshotState[];
  to: SnapshotState;
  role: MosRole;
  needsComment: boolean;
  intent: "positive" | "negative" | "neutral";
  confirm?: string; // typed confirmation phrase for high-impact moves
}

export const ACTIONS: Record<ManualAction, ActionMeta> = {
  review_pass: { label: "Pass review", verb: "passed review", from: ["ready_for_review"], to: "test_in_progress", role: "reviewer", needsComment: false, intent: "positive" },
  review_fail: { label: "Fail review", verb: "failed review", from: ["ready_for_review"], to: "review_failed", role: "reviewer", needsComment: true, intent: "negative" },
  test_pass: { label: "Record tests passed", verb: "recorded tests passed", from: ["test_in_progress"], to: "approval_pending", role: "tester", needsComment: false, intent: "positive" },
  test_fail: { label: "Record test failure", verb: "recorded a test failure", from: ["test_in_progress"], to: "test_failed", role: "tester", needsComment: true, intent: "negative" },
  retest: { label: "Start retest", verb: "started a retest", from: ["test_failed"], to: "test_in_progress", role: "tester", needsComment: true, intent: "neutral" },
  approve: { label: "Approve for PROD", verb: "approved", from: ["approval_pending"], to: "approved", role: "approver", needsComment: false, intent: "positive", confirm: "APPROVE" },
  refuse: { label: "Refuse approval", verb: "refused approval", from: ["approval_pending"], to: "approval_failed", role: "approver", needsComment: true, intent: "negative" },
  send_back: { label: "Send back for retest", verb: "sent back for retesting", from: ["approval_failed"], to: "test_in_progress", role: "approver", needsComment: true, intent: "neutral" },
  reactivate: { label: "Reactivate (rollback)", verb: "reactivated", from: ["superseded", "withdrawn"], to: "approved", role: "approver", needsComment: true, intent: "positive", confirm: "ROLLBACK" },
  withdraw: { label: "Withdraw approval", verb: "withdrew", from: ["superseded"], to: "withdrawn", role: "approver", needsComment: true, intent: "negative" },
};

export const ACTION_VERBS: Record<SnapshotAction, string> = {
  ...Object.fromEntries(Object.entries(ACTIONS).map(([k, v]) => [k, v.verb])),
  create: "started a working copy",
  submit: "submitted",
  supersede: "superseded",
} as Record<SnapshotAction, string>;

export function hasRole(roles: readonly MosRole[] | undefined, role: MosRole): boolean {
  return !!roles && (roles.includes(role) || roles.includes("admin"));
}

export interface ActionContext {
  state: SnapshotState;
  isAuthor: boolean;
  roles: readonly MosRole[];
  reviewedByMe: boolean;
  allowSelfActions: boolean;
  retired: boolean;
}

export type Availability = { action: ManualAction; enabled: boolean; reason?: string };

/** Which manual moves the current user sees for a snapshot, and why a move is disabled. */
export function availableActions(ctx: ActionContext): Availability[] {
  const out: Availability[] = [];
  for (const [key, meta] of Object.entries(ACTIONS) as [ManualAction, ActionMeta][]) {
    if (!meta.from.includes(ctx.state)) continue;
    const roleOk = hasRole(ctx.roles, meta.role) || (key === "retest" && ctx.isAuthor);
    if (!roleOk) continue;
    let reason: string | undefined;
    if (ctx.retired) reason = "Procedure is retired";
    else if (!ctx.allowSelfActions && ctx.isAuthor && ["review_pass", "review_fail", "test_pass", "test_fail", "approve", "refuse"].includes(key))
      reason = "You can't do this on your own snapshot";
    else if (!ctx.allowSelfActions && ctx.reviewedByMe && (key === "approve" || key === "refuse"))
      reason = "You reviewed this snapshot";
    out.push({ action: key, enabled: !reason, reason });
  }
  return out;
}

/** The queue a role works from: states where that role owns the next move. */
export const QUEUE_STATES: Record<Exclude<MosRole, "admin">, SnapshotState[]> = {
  author: ["in_progress", "review_failed", "test_failed", "approval_failed"],
  reviewer: ["ready_for_review"],
  tester: ["test_in_progress", "test_failed"],
  approver: ["approval_pending"],
};

export const STALE_AFTER_DAYS = 5;

export function shortHash(sha?: string | null): string {
  return sha ? sha.slice(0, 7) : "—";
}
