import { describe, expect, it } from "vitest";
import { computeProdHistory, prodAt } from "./prod-history";
import type { ProcedureEventRow, TransitionRow } from "./types";
import type { SnapshotAction, SnapshotState } from "@/lib/lifecycle";

const S2 = "snap-2";
const S3 = "snap-3";
const snapshots = [
  { id: S2, number: 2 },
  { id: S3, number: 3 },
];

let seq = 0;
const at = (h: number) => new Date(Date.UTC(2026, 9, 1, h)).toISOString();

function t(snapshot: string, action: SnapshotAction, from: SnapshotState | null, to: SnapshotState, hour: number, actor: string, extra: Partial<TransitionRow> = {}): TransitionRow {
  return {
    id: ++seq,
    snapshot_id: snapshot,
    procedure_id: "p1",
    action,
    from_state: from,
    to_state: to,
    actor_id: actor,
    comment: null,
    related_snapshot_id: null,
    evidence: {},
    created_at: at(hour),
    ...extra,
  };
}

function ev(kind: ProcedureEventRow["kind"], hour: number, actor: string, reason: string | null = null): ProcedureEventRow {
  return { id: ++seq, procedure_id: "p1", kind, actor_id: actor, reason, detail: {}, created_at: at(hour) };
}

const NOW = Date.parse(at(100));

describe("computeProdHistory", () => {
  it("returns nothing for a procedure that was never approved", () => {
    const h = computeProdHistory([t(S2, "create", null, "in_progress", 1, "a")], [ev("created", 1, "a")], snapshots, NOW);
    expect(h.segments).toEqual([]);
    expect(h.retiredWindows).toEqual([]);
  });

  it("tracks supersede, rollback, withdraw and a retire/restore window", () => {
    const transitions: TransitionRow[] = [
      t(S2, "approve", "approval_pending", "approved", 10, "appr1"),
      // #3 approved: system supersedes #2 first, then #3 becomes active (same timestamp)
      t(S2, "supersede", "approved", "superseded", 20, "appr2", { related_snapshot_id: S3, comment: "Superseded by #3" }),
      t(S3, "approve", "approval_pending", "approved", 20, "appr2"),
      // rollback: #2 reactivated, #3 superseded
      t(S3, "supersede", "approved", "superseded", 30, "appr1", { related_snapshot_id: S2, comment: "Rolled back" }),
      t(S2, "reactivate", "superseded", "approved", 30, "appr1", { related_snapshot_id: S3, comment: "Regression in #3" }),
      // #3 withdrawn (it was not active, so PROD is unaffected)
      t(S3, "withdraw", "superseded", "withdrawn", 35, "appr1", { comment: "Bad" }),
    ];
    const events = [ev("retired", 40, "appr1", "Decommissioned"), ev("restored", 50, "appr2", "Needed again")];

    const { segments, retiredWindows } = computeProdHistory(transitions, events, snapshots, NOW);

    expect(segments.map((s) => [s.number, s.from, s.to, s.endReason, s.resumed])).toEqual([
      [2, at(10), at(20), "superseded", false],
      [3, at(20), at(30), "superseded", false],
      [2, at(30), at(40), "retired", false],
      [2, at(50), null, undefined, true],
    ]);
    expect(segments[0].approvedBy).toBe("appr1");
    expect(segments[0].endedBy).toBe("appr2");
    expect(segments[0].endedByRelated).toEqual({ snapshotId: S3, number: 3 });
    expect(segments[2].approvedVia).toBe("reactivate");
    expect(segments[2].approvalComment).toBe("Regression in #3");
    expect(segments[3].approvedBy).toBe("appr1");
    expect(retiredWindows).toEqual([{ from: at(40), to: at(50), by: "appr1", reason: "Decommissioned", restoredBy: "appr2", restoreReason: "Needed again" }]);
  });

  it("keeps an open retired window and no active segment while retired", () => {
    const transitions = [t(S2, "approve", "approval_pending", "approved", 10, "appr1")];
    const { segments, retiredWindows } = computeProdHistory(transitions, [ev("retired", 20, "appr1", "EOL")], snapshots, NOW);
    expect(segments).toHaveLength(1);
    expect(segments[0].to).toBe(at(20));
    expect(segments[0].endReason).toBe("retired");
    expect(retiredWindows[0].to).toBeNull();
  });

  it("closes a window on a direct withdraw of the active snapshot", () => {
    const transitions = [
      t(S2, "approve", "approval_pending", "approved", 10, "a"),
      t(S2, "withdraw", "approved", "withdrawn", 15, "b", { comment: "pulled" }),
    ];
    const { segments } = computeProdHistory(transitions, [], snapshots, NOW);
    expect(segments[0]).toMatchObject({ to: at(15), endReason: "withdrawn", endedBy: "b", endComment: "pulled" });
  });

  it("ignores entries in the future", () => {
    const transitions = [t(S2, "approve", "approval_pending", "approved", 10, "a"), t(S3, "approve", "approval_pending", "approved", 200, "a")];
    const { segments } = computeProdHistory(transitions, [], snapshots, NOW);
    expect(segments).toHaveLength(1);
    expect(segments[0].to).toBeNull();
  });

  it("copes with the supersede row sorting after the new approval", () => {
    const transitions = [
      t(S2, "approve", "approval_pending", "approved", 10, "a"),
      t(S3, "approve", "approval_pending", "approved", 20, "b"),
      t(S2, "supersede", "approved", "superseded", 20, "b", { related_snapshot_id: S3 }),
    ];
    const { segments } = computeProdHistory(transitions, [], snapshots, NOW);
    expect(segments.map((s) => [s.number, s.to])).toEqual([
      [2, at(20)],
      [3, null],
    ]);
  });
});

describe("prodAt", () => {
  const transitions = [
    t(S2, "approve", "approval_pending", "approved", 10, "a"),
    t(S2, "supersede", "approved", "superseded", 20, "b", { related_snapshot_id: S3 }),
    t(S3, "approve", "approval_pending", "approved", 20, "b"),
  ];
  const history = computeProdHistory(transitions, [ev("retired", 30, "a", "x"), ev("restored", 40, "a", "y")], snapshots, NOW);

  it("finds the right snapshot, gap and retired window", () => {
    const num = (h: number) => {
      const r = prodAt(history, Date.parse(at(h)), NOW);
      return r.kind === "snapshot" ? r.segment.number : r.kind;
    };
    expect(num(5)).toBe("none");
    expect(num(10)).toBe(2);
    expect(num(19)).toBe(2);
    expect(num(20)).toBe(3);
    expect(num(35)).toBe("retired");
    expect(num(40)).toBe(3);
    expect(prodAt(history, NOW + 1, NOW).kind).toBe("future");
  });
});
