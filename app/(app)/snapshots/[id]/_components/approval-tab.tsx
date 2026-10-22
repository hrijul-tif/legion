"use client";

import { useMemo } from "react";
import { formatDistanceStrict } from "date-fns";
import { AlertTriangle, ArrowRight, Check, CircleDashed, FileDiff, FlaskConical, Hourglass, PlayCircle, Rocket, ScrollText, Undo2, X } from "lucide-react";
import { lineDiffStats } from "@/components/mos/code/diff-stats";
import { RelativeTime } from "@/components/mos/time";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ACTION_VERBS } from "@/lib/lifecycle";
import type { SnapshotPageData, SiblingSnapshot } from "@/lib/data/snapshot";
import type { ProcedureSignature } from "@/lib/data/types";
import { activeSibling, custodyChain, person, rollbacksInvolving, snapshotNumber, tenures, whoCanActNext, type CustodyStep, type StepStatus } from "./derive";
import { useCompareCode } from "./compare";
import { LocalTime, Pill, SectionCard, SnapLink, Who } from "./bits";
import { TransitionItem } from "./timeline";
import { RESULT_TONE } from "./test-tab";
import type { TabKey } from "./derive";

export function ApprovalTab({ data, onViewDiff, onGoto }: { data: SnapshotPageData; onViewDiff: () => void; onGoto: (tab: TabKey) => void }) {
  const own = useMemo(() => data.transitions.filter((t) => t.snapshot_id === data.snapshot.id), [data.transitions, data.snapshot.id]);
  const steps = useMemo(() => custodyChain(data.snapshot.state, own), [data.snapshot.state, own]);
  const state = data.snapshot.state;
  const wasApproved = state === "approved" || state === "superseded" || state === "withdrawn" || tenures(own).length > 0;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,25rem)]">
      <SectionCard title="Chain of custody" icon={<ScrollText />} bodyClassName="p-5">
        <p className="mb-5 text-[13px] text-muted-foreground">Who handled this snapshot, in order, and what they recorded. Each line is a real row of the audit trail.</p>
        <ol>
          {steps.map((step, i) => (
            <Step key={step.key} step={step} last={i === steps.length - 1} data={data} onGoto={onGoto} />
          ))}
        </ol>
      </SectionCard>

      <div className="space-y-4">
        {state !== "in_progress" && state !== "review_failed" && !(state === "approved") && !wasApproved && <ProdImpact data={data} onViewDiff={onViewDiff} />}
        {(state === "superseded" || state === "withdrawn") && <ProdImpact data={data} onViewDiff={onViewDiff} historic />}
        {state === "approved" && <ActiveNow data={data} onViewDiff={onViewDiff} />}
        {wasApproved && <Tenure data={data} own={own} />}
        {state === "review_failed" && (
          <SectionCard bodyClassName="text-[13px] text-muted-foreground">
            Review failed, so this snapshot never reached PROD and never will — snapshots don’t change. The fix is a new snapshot forked from this one.
          </SectionCard>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ chain of custody */

const STATUS_STYLE: Record<StepStatus, { ring: string; icon: React.ReactNode }> = {
  done: { ring: "border-tone-success/50 bg-tone-success/15 text-tone-success", icon: <Check className="size-3.5" /> },
  failed: { ring: "border-tone-danger/50 bg-tone-danger/15 text-tone-danger", icon: <X className="size-3.5" /> },
  current: { ring: "border-tone-warn/60 bg-tone-warn/15 text-tone-warn", icon: <Hourglass className="size-3.5" /> },
  pending: { ring: "border-dashed text-muted-foreground", icon: <CircleDashed className="size-3.5" /> },
};

function Step({ step, last, data, onGoto }: { step: CustodyStep; last: boolean; data: SnapshotPageData; onGoto: (t: TabKey) => void }) {
  const st = STATUS_STYLE[step.status];
  return (
    <li className="relative grid grid-cols-[2rem_minmax(0,1fr)] gap-4">
      <div className="relative flex justify-center">
        {!last && <span className={cn("absolute top-8 bottom-0 w-px", step.status === "pending" ? "border-l border-dashed" : "bg-border")} aria-hidden />}
        <span className={cn("z-10 flex size-8 items-center justify-center rounded-full border", st.ring)}>{st.icon}</span>
      </div>
      <div className={cn("min-w-0 pb-7", last && "pb-0")}>
        <div className="flex flex-wrap items-center gap-2">
          <h4 className={cn("text-sm font-semibold", step.status === "pending" && "text-muted-foreground")}>{step.title}</h4>
          {step.status === "current" && <Pill tone="warn">Waiting</Pill>}
        </div>
        <StepBody step={step} data={data} onGoto={onGoto} />
      </div>
    </li>
  );
}

function StepBody({ step, data, onGoto }: { step: CustodyStep; data: SnapshotPageData; onGoto: (t: TabKey) => void }) {
  const rows = step.rows;
  const waiting = (who: string) => {
    const next = whoCanActNext(data);
    const names = next.flatMap((n) => n.people).filter((p, i, a) => a.findIndex((x) => x.id === p.id) === i).slice(0, 3);
    return (
      <p className="mt-1 text-[13px] text-muted-foreground">
        Waiting for {who}
        {names.length > 0 && <> — {names.map((n) => n.displayName).join(", ")} can act.</>}
      </p>
    );
  };

  if (step.status === "pending") return <p className="mt-1 text-[13px] text-muted-foreground">Not reached yet.</p>;

  const comments = data.comments;
  const unresolved = comments.filter((c) => !c.resolved_at).length;
  const tests = data.tests;
  const pass = tests.filter((t) => t.result === "pass").length;
  const fail = tests.filter((t) => t.result === "fail").length;
  const blocked = tests.filter((t) => t.result === "blocked").length;
  const runIds = new Set([...data.runs.map((r) => r.id), ...tests.flatMap((t) => (t.run_id ? [t.run_id] : []))]);

  return (
    <div className="mt-2 space-y-3">
      {rows.map((t) => (
        <div key={t.id} className="rounded-lg border bg-background/40 px-3 py-2.5">
          <TransitionItem t={t} d={data} />
        </div>
      ))}

      {step.key === "submitted" && data.snapshot.summary && rows.every((r) => r.comment !== data.snapshot.summary) && (
        <p className="border-l-2 pl-3 text-[13px] text-foreground/85">{data.snapshot.summary}</p>
      )}

      {step.key === "review" && step.status !== "current" && (
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <span className="text-muted-foreground">
            {comments.length} review comment{comments.length === 1 ? "" : "s"}
          </span>
          {unresolved > 0 ? (
            <Pill tone="warn">
              <AlertTriangle /> {unresolved} unresolved
            </Pill>
          ) : comments.length > 0 ? (
            <Pill tone="success">all resolved</Pill>
          ) : null}
          <Button variant="ghost" size="xs" onClick={() => onGoto("review")}>
            Open review <ArrowRight />
          </Button>
        </div>
      )}
      {step.key === "review" && step.status === "current" && waiting("a reviewer")}

      {step.key === "test" && (step.status === "done" || step.status === "failed" || step.status === "current") && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <FlaskConical className="size-3.5 text-muted-foreground" />
            {tests.length === 0 ? (
              <span className={cn(step.status === "done" ? "text-tone-warn" : "text-muted-foreground")}>
                {step.status === "done" ? "Tests were marked passed with no test cases recorded." : "No test cases recorded yet."}
              </span>
            ) : (
              <>
                <Pill tone="success">{pass} passed</Pill>
                {fail > 0 && <Pill tone="danger">{fail} failed</Pill>}
                {blocked > 0 && <Pill tone="warn">{blocked} blocked</Pill>}
              </>
            )}
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <PlayCircle className="size-3.5" /> {runIds.size} run{runIds.size === 1 ? "" : "s"} attached
            </span>
            <Button variant="ghost" size="xs" onClick={() => onGoto("test")}>
              Open tests <ArrowRight />
            </Button>
          </div>
          {tests.length > 0 && (
            <ul className="space-y-1 text-[13px]">
              {tests.slice(0, 5).map((t) => (
                <li key={t.id} className="flex items-center gap-2">
                  <Pill tone={RESULT_TONE[t.result]} className="h-5 w-14 justify-center text-[11px] capitalize">
                    {t.result}
                  </Pill>
                  <span className="truncate">{t.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">· {person(data, t.tester_id).displayName}</span>
                </li>
              ))}
              {tests.length > 5 && <li className="text-xs text-muted-foreground">+ {tests.length - 5} more</li>}
            </ul>
          )}
        </div>
      )}
      {step.key === "test" && step.status === "current" && waiting("a tester")}
      {step.key === "approval" && step.status === "current" && waiting("an approver")}
    </div>
  );
}

/* ------------------------------------------------------------- PROD impact */

function sigDelta(prev: ProcedureSignature | null | undefined, next: ProcedureSignature | null | undefined): string[] {
  if (!prev || !next) return [];
  const out: string[] = [];
  if (prev.entrypoint !== next.entrypoint) out.push(`Entry point renamed: ${prev.entrypoint} → ${next.entrypoint}`);
  const before = new Map(prev.params.map((p) => [p.name, p]));
  const after = new Map(next.params.map((p) => [p.name, p]));
  for (const [name, p] of after) {
    const b = before.get(name);
    if (!b) out.push(`New argument ${name}: ${p.annotation}`);
    else if (b.annotation !== p.annotation) out.push(`${name}: ${b.annotation} → ${p.annotation}`);
    else if (JSON.stringify(b.default) !== JSON.stringify(p.default)) out.push(`${name} default: ${JSON.stringify(b.default) ?? "none"} → ${JSON.stringify(p.default) ?? "none"}`);
  }
  for (const name of before.keys()) if (!after.has(name)) out.push(`Argument ${name} removed`);
  return out;
}

function activeSince(data: SnapshotPageData, s: SiblingSnapshot) {
  const rows = data.transitions.filter((t) => t.snapshot_id === s.id && t.to_state === "approved");
  return rows[rows.length - 1] ?? null;
}

function ProdImpact({ data, onViewDiff, historic = false }: { data: SnapshotPageData; onViewDiff: () => void; historic?: boolean }) {
  const active = activeSibling(data);
  const n = data.snapshot.number;
  const retired = !!data.procedure.retired_at;
  const since = active ? activeSince(data, active) : null;

  return (
    <SectionCard title={historic ? "Compared with what PROD runs today" : "What changes in PROD"} icon={<Rocket />} bodyClassName="space-y-3">
      {!active ? (
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          <b className="font-medium text-foreground">Nothing is active in PROD for this procedure{retired ? " (it is retired)" : ""}.</b>{" "}
          {historic ? "" : `Approving #${n} would put it into PROD for the first time. There is no previous snapshot to compare with.`}
        </p>
      ) : (
        <>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            {historic ? (
              <>
                PROD currently runs <SnapLink id={active.id} number={active.number} sha={active.code_sha256} />.
              </>
            ) : (
              <>
                Approving #{n} makes it active <b className="font-medium text-foreground">immediately</b> and supersedes{" "}
                <SnapLink id={active.id} number={active.number} sha={active.code_sha256} />
                {since && (
                  <>
                    , active since <LocalTime date={since.created_at} />
                    {" "}(approved by {person(data, since.actor_id).displayName})
                  </>
                )}
                .
              </>
            )}
          </p>
          <ImpactStats data={data} activeId={active.id} />
          <ImpactSignature data={data} active={active} />
          <Button variant="outline" size="sm" onClick={onViewDiff} className="w-full justify-center">
            <FileDiff /> View diff against #{active.number}
          </Button>
        </>
      )}
    </SectionCard>
  );
}

function ImpactStats({ data, activeId }: { data: SnapshotPageData; activeId: string }) {
  const entry = useCompareCode(activeId);
  const res = entry?.status === "ready" ? entry.result : null;
  const stats = useMemo(() => (res?.ok ? lineDiffStats(res.data.code, data.code) : null), [res, data.code]);
  if (!res) return <Skeleton className="h-16 w-full rounded-lg" />;
  if (!res.ok || !stats) return <p className="text-xs text-muted-foreground">Couldn’t load the active snapshot to compare: {res.ok ? "" : res.error}</p>;
  const total = stats.added + stats.removed;
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border bg-background/40 px-3 py-2.5">
      <div>
        <div className="flex items-center gap-2 font-mono text-lg font-semibold tabular">
          <span className="text-tone-success">+{stats.added}</span>
          <span className="text-tone-danger">−{stats.removed}</span>
        </div>
        <p className="text-xs text-muted-foreground">{total === 0 ? "Identical code" : "lines changed"}</p>
      </div>
      <div className="h-2 w-28 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className="flex h-full">
          <div className="bg-tone-success" style={{ width: `${total ? (stats.added / total) * 100 : 0}%` }} />
          <div className="bg-tone-danger" style={{ width: `${total ? (stats.removed / total) * 100 : 0}%` }} />
        </div>
      </div>
    </div>
  );
}

function ImpactSignature({ data, active }: { data: SnapshotPageData; active: SiblingSnapshot }) {
  const delta = sigDelta(active.signature, data.snapshot.signature);
  if (delta.length === 0) return null;
  return (
    <div className="space-y-1.5 rounded-lg border border-tone-warn/25 bg-tone-warn/10 px-3 py-2.5 text-[13px]">
      <p className="flex items-center gap-1.5 font-medium">
        <AlertTriangle className="size-3.5 text-tone-warn" /> The entry-point interface changes
      </p>
      <ul className="list-inside list-disc space-y-0.5 font-mono text-[12px] text-muted-foreground">
        {delta.map((d) => (
          <li key={d}>{d}</li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">Sheets that pass arguments to this procedure may need updating.</p>
    </div>
  );
}

function ActiveNow({ data, onViewDiff }: { data: SnapshotPageData; onViewDiff: () => void }) {
  const parentId = data.snapshot.parent_snapshot_id;
  const row = activeSince(data, data.siblings.find((s) => s.id === data.snapshot.id)!);
  return (
    <SectionCard title="Active in PROD" icon={<Rocket className="text-tone-success" />} bodyClassName="space-y-2 text-[13px]">
      <p className="text-muted-foreground">
        This snapshot is exactly what PROD runs{row && (
          <>
            {" "}
            since <LocalTime date={row.created_at} /> (<RelativeTime date={row.created_at} />)
          </>
        )}
        . A newer approval supersedes it automatically; an approver can roll back to any earlier one.
      </p>
      {parentId && (
        <Button variant="outline" size="sm" onClick={onViewDiff} className="w-full">
          <FileDiff /> See what changed from the previous snapshot
        </Button>
      )}
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ tenure */

function Tenure({ data, own }: { data: SnapshotPageData; own: SnapshotPageData["transitions"] }) {
  const periods = tenures(own);
  const rollbacks = rollbacksInvolving(data.transitions, data.snapshot.id);
  const state = data.snapshot.state;
  const supersededBy = data.snapshot.superseded_by_snapshot_id ? snapshotNumber(data, data.snapshot.superseded_by_snapshot_id) : null;

  return (
    <SectionCard title="PROD tenure" icon={<ScrollText />} bodyClassName="space-y-4">
      {periods.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">This snapshot has not been active in PROD.</p>
      ) : (
        <ul className="space-y-3">
          {periods.map((p, i) => {
            const by = person(data, p.by);
            const endNumber = snapshotNumber(data, p.endedRelated);
            return (
              <li key={i} className="space-y-1 text-[13px]">
                <div className="flex flex-wrap items-center gap-x-2">
                  <span className="font-medium">{p.to ? "Was active" : "Active"}</span>
                  <LocalTime date={p.from} />
                  {p.to ? (
                    <>
                      <ArrowRight className="size-3 text-muted-foreground" />
                      <LocalTime date={p.to} />
                      <span className="text-muted-foreground">({formatDistanceStrict(new Date(p.from), new Date(p.to))})</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">to now</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {p.how === "reactivate" ? "Reactivated" : "Approved"} by <span className="text-foreground">{by.displayName}</span>
                  {p.endedBy === "supersede" && endNumber != null && p.endedRelated && (
                    <>
                      {" "}
                      · superseded by <SnapLink id={p.endedRelated} number={endNumber} />
                    </>
                  )}
                  {p.endedBy && p.endedBy !== "supersede" && (
                    <>
                      {" "}
                      · ended: {ACTION_VERBS[p.endedBy]} by {person(data, p.endedActor).displayName}
                    </>
                  )}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      {state === "superseded" && supersededBy != null && data.snapshot.superseded_by_snapshot_id && (
        <p className="text-[13px] text-muted-foreground">
          Superseded by <SnapLink id={data.snapshot.superseded_by_snapshot_id} number={supersededBy} />. An approver can reactivate this snapshot at any time — no review needed.
        </p>
      )}
      {state === "withdrawn" && <p className="text-[13px] text-muted-foreground">Approval was withdrawn. An approver can reactivate this snapshot at any time — no review needed.</p>}

      {rollbacks.length > 0 && (
        <div className="space-y-2 border-t pt-3">
          <h4 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Undo2 className="size-3.5" /> Rollbacks involving this snapshot
          </h4>
          <ul className="space-y-2">
            {rollbacks.map((r) => {
              const thisOne = r.snapshot_id === data.snapshot.id;
              const other = thisOne ? r.related_snapshot_id : r.snapshot_id;
              const otherNo = snapshotNumber(data, other);
              return (
                <li key={r.id} className="space-y-0.5 text-[13px]">
                  <div className="flex flex-wrap items-center gap-x-1.5">
                    <Who user={person(data, r.actor_id)} size={18} />
                    <span>{thisOne ? "reactivated this snapshot" : "rolled back from this snapshot"}</span>
                    {other && otherNo != null && (
                      <>
                        <span className="text-muted-foreground">{thisOne ? "replacing" : "to"}</span>
                        <SnapLink id={other} number={otherNo} />
                      </>
                    )}
                    <RelativeTime date={r.created_at} className="text-xs text-muted-foreground" />
                  </div>
                  {r.comment && <p className="border-l-2 pl-2.5 text-xs text-muted-foreground">{r.comment}</p>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </SectionCard>
  );
}
