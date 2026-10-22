import { parseAsArrayOf, parseAsBoolean, parseAsInteger, parseAsNumberLiteral, parseAsString, parseAsStringLiteral } from "nuqs/server";
import { SNAPSHOT_STATES, type SnapshotState } from "@/lib/lifecycle";

export const SNAPSHOT_SORT_KEYS = ["changed", "created", "name", "number"] as const;
export type SnapshotSortKey = (typeof SNAPSHOT_SORT_KEYS)[number];
export const PAGE_SIZES = [25, 50, 100] as const;

/** URL-state for the snapshot explorer. Shared by the server loader and the client filter bar. */
export const snapshotParsers = {
  q: parseAsString.withDefault(""),
  proc: parseAsArrayOf(parseAsString).withDefault([]),
  state: parseAsArrayOf(parseAsStringLiteral(SNAPSHOT_STATES)).withDefault([]),
  author: parseAsArrayOf(parseAsString).withDefault([]),
  mission: parseAsStringLiteral(["FF", "JTYU"] as const),
  active: parseAsBoolean.withDefault(false),
  field: parseAsStringLiteral(["changed", "created"] as const).withDefault("changed"),
  from: parseAsString,
  to: parseAsString,
  sort: parseAsStringLiteral(SNAPSHOT_SORT_KEYS).withDefault("changed"),
  dir: parseAsStringLiteral(["asc", "desc"] as const).withDefault("desc"),
  page: parseAsInteger.withDefault(1),
  size: parseAsNumberLiteral(PAGE_SIZES).withDefault(25),
};

export const STATE_GROUPS: { id: string; label: string; states: SnapshotState[] }[] = [
  { id: "working", label: "Working", states: ["in_progress"] },
  { id: "pipeline", label: "Pipeline", states: ["ready_for_review", "test_in_progress", "approval_pending"] },
  { id: "failed", label: "Failed", states: ["review_failed", "test_failed", "approval_failed"] },
  { id: "released", label: "Released", states: ["approved", "superseded", "withdrawn"] },
];

export const PIPELINE_STATES = STATE_GROUPS.find((g) => g.id === "pipeline")!.states;
export const FAILED_STATES = STATE_GROUPS.find((g) => g.id === "failed")!.states;
