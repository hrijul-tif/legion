import { ACTIONS, STATE_META, hasRole, type ManualAction, type MosRole, type SnapshotAction, type SnapshotState } from "@/lib/lifecycle";
import type { PersonLite, SiblingSnapshot, SnapshotPageData } from "@/lib/data/snapshot";
import type { TransitionRow } from "@/lib/data/types";

export const TABS = ["code", "review", "test", "approval", "history"] as const;
export type TabKey = (typeof TABS)[number];

/** The tab a person most likely wants for this state. */
export function defaultTabFor(state: SnapshotState): TabKey {
  switch (state) {
    case "ready_for_review":
      return "review";
    case "test_in_progress":
    case "test_failed":
      return "test";
    case "approval_pending":
    case "approval_failed":
    case "approved":
    case "superseded":
    case "withdrawn":
      return "approval";
    default:
      return "code";
  }
}

export const isFrozen = (state: SnapshotState) => state !== "in_progress";

export function activeSibling(d: SnapshotPageData): SiblingSnapshot | null {
  return d.siblings.find((s) => s.id === d.procedure.active_snapshot_id) ?? null;
}

export function parentSibling(d: SnapshotPageData): SiblingSnapshot | null {
  const p = d.snapshot.parent_snapshot_id ? d.siblings.find((s) => s.id === d.snapshot.parent_snapshot_id) : null;
  return p && isFrozen(p.state) ? p : null;
}

export function person(d: SnapshotPageData, id: string | null | undefined): PersonLite {
  return (id && d.people[id]) || { id: id ?? "", displayName: "Unknown", initials: "?", color: "#64748b", roles: [] };
}

export function snapshotNumber(d: SnapshotPageData, id: string | null | undefined): number | null {
  return id ? (d.siblings.find((s) => s.id === id)?.number ?? null) : null;
}

/* ------------------------------------------------------------------ custody */

export type StepStatus = "done" | "failed" | "current" | "pending";
export interface CustodyStep {
  key: "submitted" | "review" | "test" | "approval";
  title: string;
  status: StepStatus;
  rows: TransitionRow[];
}

const STEP_ACTIONS: Record<CustodyStep["key"], SnapshotAction[]> = {
  submitted: ["create", "submit"],
  review: ["review_pass", "review_fail"],
  test: ["test_pass", "test_fail", "retest", "send_back"],
  approval: ["approve", "refuse", "supersede", "reactivate", "withdraw"],
};

/** The chain of custody for one snapshot, with the actual audit rows behind each link. */
export function custodyChain(state: SnapshotState, own: TransitionRow[]): CustodyStep[] {
  const status = (): Record<CustodyStep["key"], StepStatus> => {
    switch (state) {
      case "in_progress":
        return { submitted: "current", review: "pending", test: "pending", approval: "pending" };
      case "ready_for_review":
        return { submitted: "done", review: "current", test: "pending", approval: "pending" };
      case "review_failed":
        return { submitted: "done", review: "failed", test: "pending", approval: "pending" };
      case "test_in_progress":
        return { submitted: "done", review: "done", test: "current", approval: "pending" };
      case "test_failed":
        return { submitted: "done", review: "done", test: "failed", approval: "pending" };
      case "approval_pending":
        return { submitted: "done", review: "done", test: "done", approval: "current" };
      case "approval_failed":
        return { submitted: "done", review: "done", test: "done", approval: "failed" };
      default:
        return { submitted: "done", review: "done", test: "done", approval: "done" };
    }
  };
  const st = status();
  const titles: Record<CustodyStep["key"], string> = { submitted: "Submitted", review: "Reviewed", test: "Tested", approval: "Approved for PROD" };
  const failedTitles: Record<CustodyStep["key"], string> = { submitted: "Submitted", review: "Review failed", test: "Test failed", approval: "Approval refused" };
  return (Object.keys(STEP_ACTIONS) as CustodyStep["key"][]).map((key) => ({
    key,
    title: st[key] === "failed" ? failedTitles[key] : titles[key],
    status: st[key],
    rows: own.filter((t) => STEP_ACTIONS[key].includes(t.action)),
  }));
}

/* ------------------------------------------------------------------ tenure */

export interface Tenure {
  from: string;
  to: string | null;
  by: string; // actor who put it into PROD
  how: "approve" | "reactivate";
  endedBy: SnapshotAction | null;
  endedRelated: string | null;
  endedActor: string | null;
}

/** Periods during which this snapshot was the active one in PROD. */
export function tenures(own: TransitionRow[]): Tenure[] {
  const out: Tenure[] = [];
  let open: Tenure | null = null;
  for (const t of own) {
    if (t.to_state === "approved" && t.from_state !== "approved") {
      open = { from: t.created_at, to: null, by: t.actor_id, how: t.action === "reactivate" ? "reactivate" : "approve", endedBy: null, endedRelated: null, endedActor: null };
      out.push(open);
    } else if (t.from_state === "approved" && open) {
      open.to = t.created_at;
      open.endedBy = t.action;
      open.endedRelated = t.related_snapshot_id;
      open.endedActor = t.actor_id;
      open = null;
    }
  }
  return out;
}

/** Rollbacks that involve this snapshot: it was reactivated, or it was the one rolled back from. */
export function rollbacksInvolving(all: TransitionRow[], snapshotId: string): TransitionRow[] {
  return all.filter((t) => t.action === "reactivate" && (t.snapshot_id === snapshotId || t.related_snapshot_id === snapshotId));
}

/** Approval history of a snapshot: every time somebody put it into PROD. */
export function approvalHistory(all: TransitionRow[], snapshotId: string): TransitionRow[] {
  return all.filter((t) => t.snapshot_id === snapshotId && t.to_state === "approved");
}

/* -------------------------------------------------------------- who is next */

const SELF_RESTRICTED: ManualAction[] = ["review_pass", "review_fail", "test_pass", "test_fail", "approve", "refuse"];

export interface NextActor {
  role: MosRole;
  verb: string;
  people: PersonLite[];
}

/** People who could make the next move on this snapshot (respecting separation of duties). */
export function whoCanActNext(d: SnapshotPageData): NextActor[] {
  const state = d.snapshot.state;
  const out: NextActor[] = [];
  const reviewers = new Set(d.transitions.filter((t) => t.snapshot_id === d.snapshot.id && t.action === "review_pass").map((t) => t.actor_id));
  const seen = new Set<string>();
  for (const [key, meta] of Object.entries(ACTIONS) as [ManualAction, (typeof ACTIONS)[ManualAction]][]) {
    if (!meta.from.includes(state)) continue;
    const roleKey = `${meta.role}:${key === "retest" ? "retest" : meta.role}`;
    if (seen.has(roleKey)) continue;
    seen.add(roleKey);
    const candidates = Object.values(d.people).filter((p) => {
      const isAuthor = p.id === d.snapshot.author_id;
      const ok = hasRole(p.roles, meta.role) || (key === "retest" && isAuthor);
      if (!ok) return false;
      if (!d.allowSelfActions && isAuthor && SELF_RESTRICTED.includes(key)) return false;
      if (!d.allowSelfActions && (key === "approve" || key === "refuse") && reviewers.has(p.id)) return false;
      return true;
    });
    out.push({ role: meta.role, verb: nextVerb(key), people: candidates });
  }
  return out;
}

function nextVerb(a: ManualAction): string {
  switch (a) {
    case "review_pass":
      return "review";
    case "test_pass":
      return "test";
    case "approve":
      return "approve";
    case "retest":
      return "retest";
    case "send_back":
      return "send it back";
    case "reactivate":
      return "reactivate";
    default:
      return ACTIONS[a].label.toLowerCase();
  }
}

/* ---------------------------------------------------------------- summaries */

export function stateLabel(s: SnapshotState | null): string {
  return s ? STATE_META[s].label : "—";
}

export function formatDuration(seconds: number | undefined | null): string {
  if (seconds === undefined || seconds === null || Number.isNaN(seconds)) return "—";
  if (seconds < 1) return `${Math.round(seconds * 1000)} ms`;
  if (seconds < 90) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m < 90) return `${m} m ${s} s`;
  return `${Math.floor(m / 60)} h ${m % 60} m`;
}

export function formatBytes(n: number | null | undefined): string {
  if (!n && n !== 0) return "—";
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
}

export function countLines(code: string): number {
  if (!code) return 0;
  const n = code.split("\n").length;
  return code.endsWith("\n") ? n - 1 : n;
}
