import "server-only";
import type { CurrentUser } from "@/lib/auth";
import { ACTION_VERBS, QUEUE_STATES, STALE_AFTER_DAYS, hasRole, type SnapshotAction, type SnapshotState, type Tone } from "@/lib/lifecycle";
import { fetchProcedures, fetchProfiles, fetchSnapshotRefs, personOf, type PersonView, type Supabase } from "./audit";
import type { SnapshotListRow } from "./types";

export interface QueueItem {
  snapshotId: string;
  procedureId: string;
  procedureName: string;
  number: number;
  sha: string | null;
  state: SnapshotState;
  author: PersonView;
  summary: string | null;
  since: string;
  ageDays: number;
  stale: boolean;
  href: string;
  actionLabel: string;
  failure: { comment: string | null; actor: PersonView; verb: string; at: string } | null;
}

export interface QueueSection {
  id: string;
  title: string;
  hint: string;
  tone: Tone;
  items: QueueItem[];
  /** Own snapshots left out because separation of duties forbids acting on them. */
  hiddenOwn: number;
  empty: { title: string; hint: string };
}

export interface FeedItem {
  id: number;
  at: string;
  actor: PersonView;
  verb: string;
  action: SnapshotAction;
  procedureId: string;
  procedureName: string;
  snapshotId: string;
  number: number | null;
  relatedNumber: number | null;
}

export interface HomeData {
  sections: QueueSection[];
  waiting: number;
  stale: number;
  glance: {
    activeProcedures: number;
    totalProcedures: number;
    retired: number;
    recentApprovals: FeedItem[];
    rollbacks: FeedItem[];
  };
  activity: FeedItem[];
}

const DAY = 86_400_000;
const FAILED: SnapshotState[] = ["review_failed", "test_failed", "approval_failed"];
const ATTENTION_TAB: Partial<Record<SnapshotState, string>> = { review_failed: "review", test_failed: "test", approval_failed: "approval" };

const LIST_COLUMNS =
  "id, procedure_id, procedure_name, number, state, summary, code_sha256, author_id, created_at, updated_at, state_changed_at, procedure_retired_at";
type ListRow = Pick<
  SnapshotListRow,
  "id" | "procedure_id" | "procedure_name" | "number" | "state" | "summary" | "code_sha256" | "author_id" | "created_at" | "updated_at" | "state_changed_at" | "procedure_retired_at"
>;

async function listByState(supabase: Supabase, states: SnapshotState[], authorId: string | null, order: "asc" | "desc"): Promise<ListRow[]> {
  let q = supabase.from("snapshot_list").select(LIST_COLUMNS).in("state", states);
  if (authorId) q = q.eq("author_id", authorId);
  const { data, error } = await q.is("procedure_retired_at", null).order("state_changed_at", { ascending: order === "asc" }).limit(200);
  if (error) throw error;
  return data as unknown as ListRow[];
}

interface RawTr {
  id: number;
  snapshot_id: string;
  procedure_id: string;
  action: SnapshotAction;
  to_state: SnapshotState;
  actor_id: string;
  comment: string | null;
  related_snapshot_id: string | null;
  created_at: string;
}
const TR_COLUMNS = "id, snapshot_id, procedure_id, action, to_state, actor_id, comment, related_snapshot_id, created_at";

export async function getHomeData(supabase: Supabase, user: CurrentUser): Promise<HomeData> {
  const now = Date.now();
  const weekAgo = new Date(now - 7 * DAY).toISOString();
  const monthAgo = new Date(now - 30 * DAY).toISOString();

  const wantReviewer = hasRole(user.roles, "reviewer");
  const wantTester = hasRole(user.roles, "tester");
  const wantApprover = hasRole(user.roles, "approver");
  const wantAuthor = hasRole(user.roles, "author");

  const [settings, profiles, procedures, reviewerRows, testerRows, approverRows, authorRows, approvals, rollbacks, feed] = await Promise.all([
    supabase.from("app_settings").select("allow_self_actions").maybeSingle(),
    fetchProfiles(supabase),
    fetchProcedures(supabase),
    wantReviewer ? listByState(supabase, QUEUE_STATES.reviewer, null, "asc") : Promise.resolve([] as ListRow[]),
    wantTester ? listByState(supabase, QUEUE_STATES.tester, null, "asc") : Promise.resolve([] as ListRow[]),
    wantApprover ? listByState(supabase, QUEUE_STATES.approver, null, "asc") : Promise.resolve([] as ListRow[]),
    wantAuthor ? listByState(supabase, QUEUE_STATES.author, user.id, "desc") : Promise.resolve([] as ListRow[]),
    supabase.from("state_transitions").select(TR_COLUMNS).eq("action", "approve").gte("created_at", weekAgo).order("created_at", { ascending: false }).limit(6),
    supabase.from("state_transitions").select(TR_COLUMNS).eq("action", "reactivate").gte("created_at", monthAgo).order("created_at", { ascending: false }).limit(3),
    supabase.from("state_transitions").select(TR_COLUMNS).neq("action", "supersede").order("created_at", { ascending: false }).order("id", { ascending: false }).limit(15),
  ]);
  const allowSelf = !!(settings.data as { allow_self_actions?: boolean } | null)?.allow_self_actions;
  for (const r of [approvals, rollbacks, feed]) if (r.error) throw r.error;

  // Evidence for per-item decisions.
  const failedIds = [...authorRows, ...testerRows].filter((r) => FAILED.includes(r.state)).map((r) => r.id);
  const approverIds = approverRows.map((r) => r.id);
  const [failures, myReviews] = await Promise.all([
    failedIds.length
      ? supabase.from("state_transitions").select(TR_COLUMNS).in("snapshot_id", failedIds).in("to_state", FAILED).order("created_at", { ascending: false }).order("id", { ascending: false })
      : Promise.resolve({ data: [] as RawTr[], error: null }),
    approverIds.length
      ? supabase.from("state_transitions").select("snapshot_id").eq("action", "review_pass").eq("actor_id", user.id).in("snapshot_id", approverIds)
      : Promise.resolve({ data: [] as { snapshot_id: string }[], error: null }),
  ]);
  if (failures.error) throw failures.error;
  if (myReviews.error) throw myReviews.error;
  const latestFailure = new Map<string, RawTr>();
  for (const t of failures.data as unknown as RawTr[]) if (!latestFailure.has(t.snapshot_id)) latestFailure.set(t.snapshot_id, t);
  const reviewedByMe = new Set((myReviews.data as { snapshot_id: string }[]).map((r) => r.snapshot_id));

  const toItem = (r: ListRow, href: (r: ListRow) => string, actionLabel: string, withFailure = false): QueueItem => {
    const since = r.state_changed_at ?? r.updated_at;
    const ageDays = Math.max(0, Math.floor((now - new Date(since).getTime()) / DAY));
    const f = withFailure ? latestFailure.get(r.id) : undefined;
    return {
      snapshotId: r.id,
      procedureId: r.procedure_id,
      procedureName: r.procedure_name,
      number: r.number,
      sha: r.code_sha256,
      state: r.state,
      author: personOf(profiles, r.author_id),
      summary: r.summary,
      since,
      ageDays,
      stale: ageDays >= STALE_AFTER_DAYS,
      href: href(r),
      actionLabel,
      failure: f ? { comment: f.comment, actor: personOf(profiles, f.actor_id), verb: ACTION_VERBS[f.action] ?? f.action, at: f.created_at } : null,
    };
  };
  const tab = (t: string) => (r: ListRow) => `/snapshots/${r.id}?tab=${t}`;
  const sections: QueueSection[] = [];

  if (wantReviewer) {
    const mine = reviewerRows.filter((r) => allowSelf || r.author_id !== user.id);
    sections.push({
      id: "review",
      title: "Waiting for your review",
      hint: "Frozen code, oldest first. Pass it to test or fail it with a reason.",
      tone: "info",
      items: mine.map((r) => toItem(r, tab("review"), "Review")),
      hiddenOwn: reviewerRows.length - mine.length,
      empty: { title: "Nothing waiting on you", hint: "When an author submits a snapshot, it shows up here for review." },
    });
  }
  if (wantTester) {
    const inTest = testerRows.filter((r) => r.state === "test_in_progress" && (allowSelf || r.author_id !== user.id));
    const hidden = testerRows.filter((r) => r.state === "test_in_progress").length - inTest.length;
    sections.push({
      id: "test",
      title: "In test",
      hint: "Review passed. Run it on the simulator and record the result.",
      tone: "progress",
      items: inTest.map((r) => toItem(r, tab("test"), "Open tests")),
      hiddenOwn: hidden,
      empty: { title: "No snapshots in test", hint: "Snapshots land here as soon as a reviewer passes them." },
    });
    sections.push({
      id: "retest",
      title: "Failed tests to retest",
      hint: "A failure was recorded. Retest once the cause is understood.",
      tone: "danger",
      items: testerRows.filter((r) => r.state === "test_failed").map((r) => toItem(r, tab("test"), "Retest", true)),
      hiddenOwn: 0,
      empty: { title: "No failed tests", hint: "A clean board. Failed tests that can be retried will appear here." },
    });
  }
  if (wantApprover) {
    const mine = approverRows.filter((r) => allowSelf || (r.author_id !== user.id && !reviewedByMe.has(r.id)));
    sections.push({
      id: "approval",
      title: "Awaiting your approval",
      hint: "Reviewed and tested. Your call whether it goes to PROD.",
      tone: "warn",
      items: mine.map((r) => toItem(r, tab("approval"), "Decide")),
      hiddenOwn: approverRows.length - mine.length,
      empty: { title: "Nothing waiting on you", hint: "Snapshots that pass review and testing will wait here for approval." },
    });
  }
  if (wantAuthor) {
    sections.push({
      id: "working",
      title: "Your working copies",
      hint: "Editable drafts only you can change.",
      tone: "neutral",
      items: authorRows.filter((r) => r.state === "in_progress").map((r) => toItem(r, (x) => `/snapshots/${x.id}/edit`, "Continue editing")),
      hiddenOwn: 0,
      empty: { title: "No open working copies", hint: "Open a procedure and start a working copy to begin a change." },
    });
    // Retest list already carries the failure for users who can test; avoid listing it twice.
    const attention = authorRows
      .filter((r) => FAILED.includes(r.state) && !(wantTester && r.state === "test_failed"))
      .map((r) => toItem(r, tab(ATTENTION_TAB[r.state] ?? "review"), "See why", true));
    sections.push({
      id: "attention",
      title: "Needs your attention",
      hint: "Your snapshots that were failed. Fix forward by forking a new snapshot.",
      tone: "danger",
      items: attention,
      hiddenOwn: 0,
      empty: { title: "All clear", hint: "None of your snapshots are stuck on a failure." },
    });
  }

  const actionable = sections.filter((s) => s.id !== "working");
  const all = actionable.flatMap((s) => s.items);

  // PROD at a glance
  const live = [...procedures.values()].filter((p) => !p.retired_at);
  const { data: activeRows, error: activeErr } = await supabase.from("procedures").select("id").not("active_snapshot_id", "is", null).is("retired_at", null);
  if (activeErr) throw activeErr;

  const toFeed = (rows: RawTr[], snaps: Awaited<ReturnType<typeof fetchSnapshotRefs>>): FeedItem[] =>
    rows.map((t) => ({
      id: t.id,
      at: t.created_at,
      actor: personOf(profiles, t.actor_id),
      verb: ACTION_VERBS[t.action] ?? t.action,
      action: t.action,
      procedureId: t.procedure_id,
      procedureName: procedures.get(t.procedure_id)?.name ?? "Deleted procedure",
      snapshotId: t.snapshot_id,
      number: snaps.get(t.snapshot_id)?.number ?? null,
      relatedNumber: t.related_snapshot_id ? (snaps.get(t.related_snapshot_id)?.number ?? null) : null,
    }));
  const feedRows = feed.data as unknown as RawTr[];
  const approvalRows = approvals.data as unknown as RawTr[];
  const rollbackRows = rollbacks.data as unknown as RawTr[];
  const snaps = await fetchSnapshotRefs(supabase, [...feedRows, ...approvalRows, ...rollbackRows].flatMap((t) => [t.snapshot_id, ...(t.related_snapshot_id ? [t.related_snapshot_id] : [])]));

  return {
    sections,
    waiting: all.length,
    stale: all.filter((i) => i.stale).length,
    glance: {
      activeProcedures: activeRows?.length ?? 0,
      totalProcedures: live.length,
      retired: procedures.size - live.length,
      recentApprovals: toFeed(approvalRows, snaps),
      rollbacks: toFeed(rollbackRows, snaps),
    },
    activity: toFeed(feedRows, snaps),
  };
}
