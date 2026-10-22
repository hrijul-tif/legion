import Link from "next/link";
import { ArrowRight, CheckCheck, Clock, EyeOff, Hourglass } from "lucide-react";
import { SnapshotRef } from "@/components/mos/hash";
import { StateBadge, ToneDot } from "@/components/mos/state-badge";
import { RelativeTime } from "@/components/mos/time";
import { UserAvatar } from "@/components/mos/user-avatar";
import { Button } from "@/components/ui/button";
import { STALE_AFTER_DAYS } from "@/lib/lifecycle";
import { cn } from "@/lib/utils";
import type { QueueItem, QueueSection } from "@/lib/data/queue";

function Row({ item, index }: { item: QueueItem; index: number }) {
  return (
    <li
      className="group relative flex items-start gap-4 px-4 py-3.5 transition-colors hover:bg-muted/40 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-200"
      style={{ animationDelay: `${Math.min(index, 8) * 30}ms`, animationFillMode: "backwards" }}
    >
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <Link href={`/procedures/${item.procedureId}`} className="relative z-10 truncate text-sm font-medium hover:underline">
            {item.procedureName}
          </Link>
          <Link href={`/snapshots/${item.snapshotId}`} className="relative z-10 rounded text-sm hover:underline">
            <SnapshotRef number={item.number} sha={item.sha} />
          </Link>
          <StateBadge state={item.state} size="xs" short showCode={false} />
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <UserAvatar user={{ displayName: item.author.displayName, initials: item.author.initials, color: item.author.color }} size={16} />
            {item.author.displayName}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3" />
            <RelativeTime date={item.since} addSuffix={false} className="tabular" /> in this state
          </span>
          {item.stale && (
            <span
              title={`No movement for ${item.ageDays} days (flagged after ${STALE_AFTER_DAYS})`}
              className="inline-flex items-center gap-1 rounded-full border border-tone-warn/30 bg-tone-warn/10 px-1.5 py-px font-medium text-tone-warn"
            >
              <Hourglass className="size-3" />
              Stale · {item.ageDays}d
            </span>
          )}
        </div>
        {item.summary && !item.failure && <p className="line-clamp-1 text-xs text-muted-foreground/80">{item.summary}</p>}
        {item.failure && (
          <blockquote className="mt-1 rounded-md border-l-2 border-tone-danger/50 bg-tone-danger/5 py-1.5 pr-2 pl-3 text-xs">
            <p className="line-clamp-2 text-foreground/90">{item.failure.comment ?? "No comment was recorded."}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {item.failure.actor.displayName} {item.failure.verb} · <RelativeTime date={item.failure.at} />
            </p>
          </blockquote>
        )}
      </div>
      <Button asChild size="sm" variant={item.state === "in_progress" ? "outline" : "default"} className="shrink-0 self-center">
        <Link href={item.href} className="after:absolute after:inset-0">
          {item.actionLabel}
          <ArrowRight data-icon="inline-end" className="transition-transform group-hover:translate-x-0.5" />
        </Link>
      </Button>
    </li>
  );
}

export function QueueSectionCard({ section }: { section: QueueSection }) {
  const n = section.items.length;
  return (
    <section aria-labelledby={`q-${section.id}`} className="overflow-hidden rounded-xl border bg-card">
      <header className="flex items-center gap-2.5 border-b px-4 py-3">
        <ToneDot tone={section.tone} />
        <h2 id={`q-${section.id}`} className="text-sm font-semibold">
          {section.title}
        </h2>
        <span className={cn("tabular rounded-full px-1.5 text-xs font-medium", n ? "bg-muted text-foreground" : "text-muted-foreground")}>{n}</span>
        <p className="ml-auto hidden truncate text-xs text-muted-foreground md:block">{section.hint}</p>
      </header>
      {n ? (
        <ul className="divide-y">
          {section.items.map((item, i) => (
            <Row key={item.snapshotId} item={item} index={i} />
          ))}
        </ul>
      ) : (
        <div className="flex items-center gap-3 px-4 py-5">
          <span className="grid size-9 shrink-0 place-items-center rounded-full border border-tone-success/30 bg-tone-success/10 text-tone-success">
            <CheckCheck className="size-4" />
          </span>
          <div>
            <p className="text-sm font-medium">{section.empty.title}</p>
            <p className="text-xs text-muted-foreground">{section.empty.hint}</p>
          </div>
        </div>
      )}
      {section.hiddenOwn > 0 && (
        <p className="flex items-center gap-1.5 border-t bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
          <EyeOff className="size-3.5" />
          {section.hiddenOwn} of your own {section.hiddenOwn === 1 ? "snapshot is" : "snapshots are"} hidden. Someone else has to act on {section.hiddenOwn === 1 ? "it" : "them"}.
        </p>
      )}
    </section>
  );
}
