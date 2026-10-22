import { createLoader, parseAsArrayOf, parseAsInteger, parseAsString, parseAsStringLiteral } from "nuqs/server";

export const STATUS_FILTERS = ["active", "none", "pending", "working", "retired"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export const STATUS_FILTER_META: Record<StatusFilter, { label: string; hint: string }> = {
  active: { label: "Active in PROD", hint: "Has an approved snapshot PROD can run" },
  none: { label: "No approved snapshot", hint: "PROD cannot run these yet" },
  pending: { label: "Pending work", hint: "Something is in review, in test or awaiting approval" },
  working: { label: "Has working copies", hint: "Someone is editing it right now" },
  retired: { label: "Retired", hint: "Show only retired procedures (hidden otherwise)" },
};

export const SORTS = ["activity", "name", "active"] as const;
export type ProcedureSort = (typeof SORTS)[number];
export const SORT_LABELS: Record<ProcedureSort, string> = {
  activity: "Last activity",
  name: "Name",
  active: "Active since",
};

export const PAGE_SIZE = 40;

export const procedureParsers = {
  q: parseAsString.withDefault(""),
  mission: parseAsStringLiteral(["FF", "JTYU"] as const),
  area: parseAsString,
  status: parseAsArrayOf(parseAsStringLiteral(STATUS_FILTERS)).withDefault([]),
  sort: parseAsStringLiteral(SORTS).withDefault("activity"),
  page: parseAsInteger.withDefault(1),
};

export const loadProcedureFilters = createLoader(procedureParsers);
