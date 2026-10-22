import Link from "next/link";
import { ArrowRight, Rocket, ScrollText } from "lucide-react";
import { EmptyState } from "@/components/mos/page-header";
import { LocalTime } from "@/components/mos/tables/local-time";
import { StateBadge } from "@/components/mos/state-badge";
import { RelativeTime } from "@/components/mos/time";
import { UserAvatar } from "@/components/mos/user-avatar";
import type { AuditEntry } from "@/lib/data/audit";
import { cn } from "@/lib/utils";

/** Accent colour for rows that change what PROD runs. */
const ACCENT: Record<string, string> = {
  approve: "border-l-tone-success",
  reactivate: "border-l-tone-warn",
  supersede: "border-l-tone-muted",
  withdraw: "border-l-tone-danger",
  retired: "border-l-tone-danger",
  restored: "border-l-tone-success",
};

const KIND_LABEL: Record<string, string> = {
  created: "Procedure",
  retired: "Procedure",
  restored: "Procedure",
  working_copy_discarded: "Procedure",
};

function Row({ e }: { e: AuditEntry }) {
  return (
    <li className={cn("flex flex-wrap items-start gap-x-4 gap-y-2 border-l-2 px-4 py-3 transition-colors hover:bg-muted/30", e.production ? ACCENT[e.action] : "border-l-transparent")}>
      <div className="w-36 shrink-0 space-y-0.5 text-xs">
        <LocalTime date={e.at} fmt="d MMM yyyy, HH:mm:ss" className="block font-mono tabular text-foreground/80" />
        <RelativeTime date={e.at} className="block text-muted-foreground" />
      </div>

      <div className="min-w-0 flex-1 basis-80 space-y-1">
        <p className="text-sm leading-snug">
          <span className="inline-flex items-center gap-1.5 align-middle">
            <UserAvatar user={e.actor} size={18} />
            <span className="font-medium">{e.actor.displayName}</span>
          </span>{" "}
          <span className="text-muted-foreground">{e.verb}</span>{" "}
          <Link href={`/procedures/${e.procedureId}`} className="font-medium hover:underline">
            {e.procedureName}
          </Link>
          {e.snapshotId && e.snapshotNumber !== null && (
            <>
              {" "}
              <Link href={`/snapshots/${e.snapshotId}`} className="font-mono font-semibold hover:underline">
                #{e.snapshotNumber}
              </Link>
            </>
          )}
          {e.production && (
            <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-tone-warn/30 bg-tone-warn/10 px-1.5 align-middle text-[10px] font-semibold tracking-wide text-tone-warn uppercase">
              <Rocket className="size-3" /> PROD
            </span>
          )}
        </p>
        {e.relation && <p className="text-xs font-medium text-foreground/80">{e.relation}</p>}
        {e.comment && <p className="max-w-3xl border-l-2 pl-2.5 text-xs whitespace-pre-wrap text-muted-foreground">{e.comment}</p>}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {e.to ? (
          <>
            {e.from ? <StateBadge state={e.from} size="xs" short showCode={false} /> : <span className="text-[11px] text-muted-foreground">new</span>}
            <ArrowRight className="size-3 text-muted-foreground" />
            <StateBadge state={e.to} size="xs" short showCode={false} />
          </>
        ) : (
          <span className="rounded-full border px-2 py-px text-[11px] text-muted-foreground">{KIND_LABEL[e.action] ?? "Event"}</span>
        )}
      </div>
    </li>
  );
}

export function AuditRows({ entries }: { entries: AuditEntry[] }) {
  if (entries.length === 0) {
    return (
      <EmptyState icon={<ScrollText />} title="No audit entries match">
        Every state change and procedure event is recorded here. Widen the date range or clear a filter.
      </EmptyState>
    );
  }
  return (
    <ul className="divide-y overflow-hidden rounded-xl border bg-card">
      {entries.map((e) => (
        <Row key={e.key} e={e} />
      ))}
    </ul>
  );
}
