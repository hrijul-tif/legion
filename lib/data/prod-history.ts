// Pure derivation of "which snapshot was in PROD when" from the audit trail.
// Kept free of server-only imports so it can run in vitest and in client components.
import type { ProcedureEventRow, TransitionRow } from "./types";

export type ProdEndReason = "superseded" | "withdrawn" | "retired";

export interface ProdSegment {
  snapshotId: string;
  number: number;
  /** ISO timestamp the snapshot (re)entered PROD. */
  from: string;
  /** ISO timestamp it left PROD; null while it is still active. */
  to: string | null;
  approvedBy: string;
  approvedVia: "approve" | "reactivate";
  approvalComment: string | null;
  /** True when this segment restarts after a retire/restore window (same approval, PROD available again). */
  resumed: boolean;
  endedBy?: string;
  endReason?: ProdEndReason;
  endComment?: string | null;
  /** For superseded: the snapshot that took over. */
  endedByRelated?: { snapshotId: string; number: number };
}

export interface RetiredWindow {
  from: string;
  /** null while still retired. */
  to: string | null;
  by: string;
  reason: string | null;
  restoredBy?: string;
  restoreReason?: string | null;
}

export interface ProdHistory {
  segments: ProdSegment[];
  retiredWindows: RetiredWindow[];
}

type SnapshotLite = { id: string; number: number };

type Entry = { at: number; order: number; kind: "t"; row: TransitionRow } | { at: number; order: number; kind: "e"; row: ProcedureEventRow };

/**
 * Walk transitions and retire/restore events in time order.
 *  - to_state 'approved' (approve / reactivate) opens a segment;
 *  - a move out of 'approved' (the system 'supersede' row, or a withdraw) closes it;
 *  - 'retired' closes the open segment with reason 'retired' and opens a retired window;
 *    'restored' closes the window and, if a snapshot was active, resumes it.
 * Entries after `now` are ignored.
 */
export function computeProdHistory(
  transitions: readonly TransitionRow[],
  events: readonly ProcedureEventRow[],
  snapshots: readonly SnapshotLite[],
  now: Date | number = Date.now(),
): ProdHistory {
  const nowMs = typeof now === "number" ? now : now.getTime();
  const numberOf = new Map(snapshots.map((s) => [s.id, s.number]));
  const num = (id: string) => numberOf.get(id) ?? 0;

  const entries: Entry[] = [];
  for (const t of transitions) entries.push({ at: Date.parse(t.created_at), order: t.id, kind: "t", row: t });
  for (const e of events) {
    if (e.kind === "retired" || e.kind === "restored") entries.push({ at: Date.parse(e.created_at), order: e.id, kind: "e", row: e });
  }
  entries.sort((a, b) => a.at - b.at || (a.kind === b.kind ? a.order - b.order : a.kind === "t" ? -1 : 1));

  const segments: ProdSegment[] = [];
  const retiredWindows: RetiredWindow[] = [];
  let open: ProdSegment | null = null;
  let lastActive: ProdSegment | null = null; // what was active when retirement began
  let window: RetiredWindow | null = null;

  const close = (to: string, reason: ProdEndReason, by: string, comment: string | null, related?: string | null) => {
    if (!open) return;
    open.to = to;
    open.endReason = reason;
    open.endedBy = by;
    open.endComment = comment;
    if (related) open.endedByRelated = { snapshotId: related, number: num(related) };
    open = null;
  };

  for (const entry of entries) {
    if (entry.at > nowMs) continue;
    if (entry.kind === "t") {
      const t = entry.row;
      const cur = open as ProdSegment | null;
      if (t.to_state === "approved") {
        // Defensive: a new approval implies whoever was active is out, even if the supersede row sorts later.
        if (cur && cur.snapshotId !== t.snapshot_id) close(t.created_at, "superseded", t.actor_id, null, t.snapshot_id);
        if ((open as ProdSegment | null)?.snapshotId === t.snapshot_id) continue;
        const seg: ProdSegment = {
          snapshotId: t.snapshot_id,
          number: num(t.snapshot_id),
          from: t.created_at,
          to: null,
          approvedBy: t.actor_id,
          approvedVia: t.action === "reactivate" ? "reactivate" : "approve",
          approvalComment: t.comment,
          resumed: false,
        };
        segments.push(seg);
        open = seg;
        lastActive = seg;
      } else if (t.from_state === "approved" && cur && cur.snapshotId === t.snapshot_id) {
        const superseded = t.action === "supersede";
        close(t.created_at, superseded ? "superseded" : "withdrawn", t.actor_id, t.comment, superseded ? t.related_snapshot_id : null);
        lastActive = null;
      }
    } else {
      const e = entry.row;
      if (e.kind === "retired" && !window) {
        const cur = open as ProdSegment | null;
        if (cur) close(e.created_at, "retired", e.actor_id, e.reason);
        window = { from: e.created_at, to: null, by: e.actor_id, reason: e.reason };
        retiredWindows.push(window);
      } else if (e.kind === "restored" && window) {
        window.to = e.created_at;
        window.restoredBy = e.actor_id;
        window.restoreReason = e.reason;
        window = null;
        // Snapshot states are untouched by retirement, so the approved snapshot is available again.
        const prev: ProdSegment | null = lastActive;
        if (prev && !open) {
          const seg: ProdSegment = { ...prev, from: e.created_at, to: null, resumed: true, endedBy: undefined, endReason: undefined, endComment: undefined, endedByRelated: undefined };
          segments.push(seg);
          open = seg;
          lastActive = seg;
        }
      }
    }
  }

  return { segments, retiredWindows };
}

export type ProdAt =
  | { kind: "snapshot"; segment: ProdSegment }
  | { kind: "retired"; window: RetiredWindow }
  | { kind: "none" }
  | { kind: "future" };

/** What PROD could run at an instant. Segment starts are inclusive, ends exclusive. */
export function prodAt(history: ProdHistory, instant: Date | number, now: Date | number = Date.now()): ProdAt {
  const ms = typeof instant === "number" ? instant : instant.getTime();
  const nowMs = typeof now === "number" ? now : now.getTime();
  if (ms > nowMs) return { kind: "future" };
  for (const w of history.retiredWindows) {
    if (ms >= Date.parse(w.from) && (w.to === null || ms < Date.parse(w.to))) return { kind: "retired", window: w };
  }
  for (const s of history.segments) {
    if (ms >= Date.parse(s.from) && (s.to === null || ms < Date.parse(s.to))) return { kind: "snapshot", segment: s };
  }
  return { kind: "none" };
}
