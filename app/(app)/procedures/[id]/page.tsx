import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Archive } from "lucide-react";
import { PageBody, PageHeader } from "@/components/mos/page-header";
import { RelativeTime } from "@/components/mos/time";
import { UserChip } from "@/components/mos/user-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { ActivityTimeline } from "@/components/mos/procedure/activity-timeline";
import { LocalTime } from "@/components/mos/procedure/local-time";
import { personOf, toPeople } from "@/components/mos/procedure/people";
import { ProcedureActions } from "@/components/mos/procedure/procedure-actions";
import { ProdHistoryStrip } from "@/components/mos/procedure/prod-history";
import { SnapshotLineage } from "@/components/mos/procedure/snapshot-lineage";
import { WhereIsIt, type ProdApproval } from "@/components/mos/procedure/where-is-it";
import { getCurrentUser } from "@/lib/auth";
import { hasRole } from "@/lib/lifecycle";
import { computeProdHistory, getProcedureBundle } from "@/lib/data/procedures";

export const metadata: Metadata = { title: "Procedure" };

export default function ProcedurePage({ params }: PageProps<"/procedures/[id]">) {
  return (
    <Suspense fallback={<DetailSkeleton />}>
      <Detail params={params} />
    </Suspense>
  );
}

async function Detail({ params }: { params: PageProps<"/procedures/[id]">["params"] }) {
  const { id } = await params;
  const [user, bundle] = await Promise.all([getCurrentUser(), getProcedureBundle(id)]);
  if (!bundle) notFound();

  const { procedure: p, snapshots, transitions, events, profiles, nowMs } = bundle;
  const people = toPeople(profiles);
  const retired = !!p.retired_at;

  const numbers = Object.fromEntries(snapshots.map((s) => [s.id, s.number]));
  const history = computeProdHistory(transitions, events, snapshots.map((s) => ({ id: s.id, number: s.number })), nowMs);

  const active = snapshots.find((s) => s.is_active) ?? null;
  const approvalRow = active ? transitions.find((t) => t.snapshot_id === active.id && t.to_state === "approved") : undefined;
  const approval: ProdApproval | null = approvalRow
    ? { actorId: approvalRow.actor_id, at: approvalRow.created_at, via: approvalRow.action === "reactivate" ? "reactivate" : "approve", comment: approvalRow.comment }
    : null;

  const frozen = snapshots.filter((s) => s.state !== "in_progress");
  const latestFrozen = frozen[0] ?? null; // snapshots are newest first
  const forkParent = active ? { id: active.id, number: active.number, kind: "active" as const } : latestFrozen ? { id: latestFrozen.id, number: latestFrozen.number, kind: "latest" as const } : null;
  const myCopy = snapshots.find((s) => s.state === "in_progress" && s.author_id === user.id) ?? null;

  const retireEvent = events.find((e) => e.kind === "retired");
  const creator = personOf(people, p.created_by);

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="flex items-center gap-1.5">
            <Link href="/procedures" className="rounded hover:text-foreground hover:underline">
              Procedures
            </Link>
            <span aria-hidden>/</span>
            <span className="rounded border px-1 font-mono text-[10px] leading-4">{p.mission}</span>
            {p.folder && <span className="font-mono">{p.folder}</span>}
          </span>
        }
        title={
          <span className="font-mono text-xl sm:text-2xl" title={p.name}>
            {p.name}
          </span>
        }
        description={
          <span className="block space-y-1.5">
            {p.description && <span className="block">{p.description}</span>}
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              Created by <UserChip user={creator} className="text-xs" /> <RelativeTime date={p.created_at} />
              <span aria-hidden>·</span>
              <span className="tabular">
                {p.total_snapshots} snapshot{p.total_snapshots === 1 ? "" : "s"}
              </span>
            </span>
          </span>
        }
        actions={
          <ProcedureActions
            procedureId={p.id}
            procedureName={p.name}
            retired={retired}
            canAuthor={hasRole(user.roles, "author")}
            canApprove={hasRole(user.roles, "approver")}
            forkParent={forkParent}
            myCopy={myCopy ? { id: myCopy.id, number: myCopy.number } : null}
            forkables={frozen.map((s) => ({ id: s.id, number: s.number, state: s.state, summary: s.summary }))}
          />
        }
      />

      {retired && (
        <div role="status" className="flex flex-wrap items-start gap-3 border-b border-tone-danger/25 bg-tone-danger/[0.07] px-6 py-3 text-sm lg:px-8">
          <Archive className="mt-0.5 size-4 shrink-0 text-tone-danger" />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-tone-danger">Retired — blocked from use, and not available to PROD</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {p.retired_reason ? <>“{p.retired_reason}”</> : "No reason recorded."}
              {retireEvent && (
                <>
                  {" "}
                  — {personOf(people, retireEvent.actor_id).displayName}, <LocalTime date={p.retired_at ?? retireEvent.created_at} fmt="d MMM yyyy, HH:mm" /> (<RelativeTime date={p.retired_at ?? retireEvent.created_at} />)
                </>
              )}
              . Snapshots keep their states; restoring brings the approved snapshot back.
            </p>
          </div>
        </div>
      )}

      <PageBody className="space-y-6">
        <WhereIsIt snapshots={snapshots} people={people} currentUserId={user.id} retired={retired} nowMs={nowMs} approval={approval} />
        <ProdHistoryStrip history={history} people={people} nowMs={nowMs} createdAt={p.created_at} />
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <SnapshotLineage snapshots={snapshots} currentUserId={user.id} />
          <ActivityTimeline transitions={transitions} events={events} snapshotNumbers={numbers} people={people} />
        </div>
      </PageBody>
    </>
  );
}

function DetailSkeleton() {
  return (
    <>
      <header className="space-y-3 border-b px-6 pt-6 pb-5 lg:px-8">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-8 w-96 max-w-full" />
        <Skeleton className="h-4 w-2/3" />
      </header>
      <div className="space-y-6 px-6 py-6 lg:px-8">
        <Skeleton className="h-72 w-full rounded-2xl" />
        <Skeleton className="h-44 w-full rounded-2xl" />
        <div className="grid gap-6 xl:grid-cols-[3fr_2fr]">
          <Skeleton className="h-96 rounded-2xl" />
          <Skeleton className="h-96 rounded-2xl" />
        </div>
      </div>
    </>
  );
}
