import { parseAsArrayOf, parseAsBoolean, parseAsInteger, parseAsNumberLiteral, parseAsString } from "nuqs/server";

export const AUDIT_PAGE_SIZES = [25, 50, 100] as const;

/** URL-state for the audit log (and its CSV export). `ip` / `at` drive the incident lookup card. */
export const auditParsers = {
  proc: parseAsArrayOf(parseAsString).withDefault([]),
  actor: parseAsArrayOf(parseAsString).withDefault([]),
  kind: parseAsArrayOf(parseAsString).withDefault([]),
  from: parseAsString,
  to: parseAsString,
  prod: parseAsBoolean.withDefault(false),
  page: parseAsInteger.withDefault(1),
  size: parseAsNumberLiteral(AUDIT_PAGE_SIZES).withDefault(50),
  ip: parseAsString,
  at: parseAsString,
};

/** Snapshot-level actions and procedure-level events a user can filter on, with display labels. */
export const AUDIT_KIND_OPTIONS: { value: string; label: string; group: "Snapshot" | "Procedure" }[] = [
  { value: "create", label: "Working copy started", group: "Snapshot" },
  { value: "submit", label: "Submitted", group: "Snapshot" },
  { value: "review_pass", label: "Review passed", group: "Snapshot" },
  { value: "review_fail", label: "Review failed", group: "Snapshot" },
  { value: "test_pass", label: "Tests passed", group: "Snapshot" },
  { value: "test_fail", label: "Test failed", group: "Snapshot" },
  { value: "retest", label: "Retest started", group: "Snapshot" },
  { value: "approve", label: "Approved", group: "Snapshot" },
  { value: "refuse", label: "Approval refused", group: "Snapshot" },
  { value: "send_back", label: "Sent back for retest", group: "Snapshot" },
  { value: "supersede", label: "Superseded", group: "Snapshot" },
  { value: "reactivate", label: "Reactivated (rollback)", group: "Snapshot" },
  { value: "withdraw", label: "Withdrawn", group: "Snapshot" },
  { value: "created", label: "Procedure created", group: "Procedure" },
  { value: "retired", label: "Procedure retired", group: "Procedure" },
  { value: "restored", label: "Procedure restored", group: "Procedure" },
  { value: "working_copy_discarded", label: "Working copy discarded", group: "Procedure" },
];

/** Actions that change what PROD runs (or whether it may). */
export const PRODUCTION_KINDS = ["approve", "supersede", "reactivate", "withdraw", "retired", "restored"];
