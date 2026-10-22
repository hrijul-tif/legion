import Link from "next/link";
import { ArrowRight, History, RotateCcw, Rocket, ShieldCheck } from "lucide-react";
import { RelativeTime } from "@/components/mos/time";
import { UserAvatar } from "@/components/mos/user-avatar";
import type { FeedItem, HomeData } from "@/lib/data/queue";
import { cn } from "@/lib/utils";

function Ref({ item }: { item: FeedItem }) {
  if (item.number === null) return null;
  return (
    <Link href={`/snapshots/${item.snapshotId}`} className="font-mono text-foreground hover:underline">
      #{item.number}
    </Link>
  );
}

export function ProdGlance({ glance }: { glance: HomeData["glance"] }) {
  const pct = glance.totalProcedures ? Math.round((glance.activeProcedures / glance.totalProcedures) * 100) : 0;
  return (
    <section aria-labelledby="prod-glance" className="overflow-hidden rounded-xl border bg-card">
      <header className="relative border-b bg-grid px-4 py-4">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(closest-side,var(--glow),transparent)]" />
        <div className="relative">
          <h2 id="prod-glance" className="flex items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            <Rocket className="size-3.5" /> PROD at a glance
          </h2>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="tabular text-4xl font-semibold tracking-tight">{glance.activeProcedures}</span>
            <span className="text-sm text-muted-foreground">
              of <span className="tabular">{glance.totalProcedures}</span> procedures have an active snapshot
            </span>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${pct}% of procedures have an active snapshot`}>
            <div className="h-full rounded-full bg-tone-success transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            <span className="tabular">{glance.retired}</span> retired · <span className="tabular">{Math.max(0, glance.totalProcedures - glance.activeProcedures)}</span> without anything approved yet
          </p>
        </div>
      </header>

      <div className="space-y-4 p-4">
        <div>
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <ShieldCheck className="size-3.5 text-tone-success" /> Approved in the last 7 days
          </h3>
          {glance.recentApprovals.length ? (
            <ul className="space-y-2">
              {glance.recentApprovals.map((a) => (
                <li key={a.id} className="flex items-center gap-2 text-sm">
                  <UserAvatar user={a.actor} size={18} />
                  <span className="min-w-0 flex-1 truncate">
                    <Link href={`/procedures/${a.procedureId}`} className="font-medium hover:underline">
                      {a.procedureName}
                    </Link>{" "}
                    <Ref item={a} />
                  </span>
                  <RelativeTime date={a.at} className="shrink-0 text-xs text-muted-foreground" />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">Nothing new went to PROD this week.</p>
          )}
        </div>

        <div>
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <RotateCcw className="size-3.5 text-tone-warn" /> Rollbacks · 30 days
          </h3>
          {glance.rollbacks.length ? (
            <ul className="space-y-2">
              {glance.rollbacks.map((r) => (
                <li key={r.id} className="rounded-lg border border-tone-warn/30 bg-tone-warn/10 px-3 py-2 text-sm">
                  <div className="flex items-center gap-2">
                    <Link href={`/procedures/${r.procedureId}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                      {r.procedureName}
                    </Link>
                    <RelativeTime date={r.at} className="shrink-0 text-xs text-muted-foreground" />
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {r.relatedNumber !== null && (
                      <>
                        <span className="font-mono text-foreground">#{r.relatedNumber}</span> →{" "}
                      </>
                    )}
                    <Ref item={r} /> by {r.actor.displayName}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">No rollbacks. PROD has been steady.</p>
          )}
        </div>
      </div>
    </section>
  );
}

export function ActivityFeed({ items }: { items: FeedItem[] }) {
  return (
    <section aria-labelledby="recent-activity" className="overflow-hidden rounded-xl border bg-card">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <h2 id="recent-activity" className="flex items-center gap-2 text-sm font-semibold">
          <History className="size-4 text-muted-foreground" /> Recent activity
        </h2>
        <Link href="/audit" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          Audit log <ArrowRight className="size-3" />
        </Link>
      </header>
      {items.length ? (
        <ol className="p-2">
          {items.map((a) => (
            <li key={a.id} className="flex gap-2.5 rounded-lg px-2 py-1.5 text-[13px] hover:bg-muted/40">
              <UserAvatar user={a.actor} size={20} className="mt-0.5" />
              <p className="min-w-0 flex-1 leading-snug">
                <span className="font-medium">{a.actor.displayName}</span> <span className="text-muted-foreground">{a.verb}</span>{" "}
                <Link href={`/procedures/${a.procedureId}`} className={cn("font-medium hover:underline")}>
                  {a.procedureName}
                </Link>{" "}
                <Ref item={a} />
                {a.action === "reactivate" && a.relatedNumber !== null && <span className="text-muted-foreground"> (replacing #{a.relatedNumber})</span>}
                <RelativeTime date={a.at} className="block text-[11px] text-muted-foreground" />
              </p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">Activity will show up here as soon as someone moves a snapshot.</p>
      )}
    </section>
  );
}
