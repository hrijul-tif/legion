"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { format, isToday, isYesterday } from "date-fns";
import { ArchiveRestore, Archive, ArrowRight, Eraser, History, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StateBadge } from "@/components/mos/state-badge";
import { UserAvatar } from "@/components/mos/user-avatar";
import { RelativeTime } from "@/components/mos/time";
import { ACTION_VERBS } from "@/lib/lifecycle";
import { cn } from "@/lib/utils";
import type { ProcedureEventRow, TransitionRow } from "@/lib/data/types";
import { useMounted } from "./local-time";
import { personOf, type People } from "./people";

type Item =
  | { kind: "t"; at: string; id: number; row: TransitionRow }
  | { kind: "e"; at: string; id: number; row: ProcedureEventRow };

const PAGE = 40;

export function ActivityTimeline({ transitions, events, snapshotNumbers, people }: { transitions: TransitionRow[]; events: ProcedureEventRow[]; snapshotNumbers: Record<string, number>; people: People }) {
  const mounted = useMounted();
  const [limit, setLimit] = useState(PAGE);

  const items = useMemo<Item[]>(() => {
    const all: Item[] = [
      ...transitions.map((row): Item => ({ kind: "t", at: row.created_at, id: row.id, row })),
      ...events.map((row): Item => ({ kind: "e", at: row.created_at, id: row.id, row })),
    ];
    return all.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || (a.kind === b.kind ? b.id - a.id : a.kind === "t" ? 1 : -1));
  }, [transitions, events]);

  const shown = items.slice(0, limit);

  return (
    <section aria-labelledby="activity-heading" className="rounded-2xl border bg-card/50">
      <div className="border-b px-5 py-3">
        <h2 id="activity-heading" className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <History className="size-4 text-muted-foreground" /> Activity
          <span className="tabular rounded-md bg-muted px-1.5 font-mono text-[11px] font-normal text-muted-foreground">{items.length}</span>
        </h2>
        <p className="text-xs text-muted-foreground">Who did what, newest first. The audit trail is append-only.</p>
      </div>
      {items.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-muted-foreground">No activity recorded yet.</p>
      ) : (
        <ol className="relative px-5 py-4">
          <span aria-hidden className="absolute top-4 bottom-4 left-[29px] w-px bg-border" />
          {shown.map((item, i) => {
            const day = mounted ? dayKey(item.at) : null;
            const prevDay = i > 0 && mounted ? dayKey(shown[i - 1].at) : null;
            return (
              <Fragment key={`${item.kind}-${item.id}`}>
                {day && day !== prevDay && (
                  <li className={cn("relative z-10 mb-2 ml-9 text-[11px] font-medium tracking-wide text-muted-foreground uppercase", i > 0 && "mt-4")}>{dayLabel(item.at)}</li>
                )}
                <li className="relative flex gap-3 pb-4 last:pb-0">
                  <UserAvatar user={personOf(people, item.kind === "t" ? item.row.actor_id : item.row.actor_id)} size={20} ring className="relative z-10 mt-0.5" />
                  <div className="min-w-0 flex-1 text-xs leading-5">
                    {item.kind === "t" ? <TransitionLine t={item.row} numbers={snapshotNumbers} people={people} /> : <EventLine e={item.row} people={people} />}
                  </div>
                  <RelativeTime date={item.at} className="shrink-0 pt-0.5 text-[11px] text-muted-foreground" />
                </li>
              </Fragment>
            );
          })}
        </ol>
      )}
      {items.length > limit && (
        <div className="border-t px-5 py-2.5">
          <Button variant="ghost" size="sm" onClick={() => setLimit((l) => l + PAGE)}>
            Show {Math.min(PAGE, items.length - limit)} older
          </Button>
        </div>
      )}
    </section>
  );
}

function dayKey(iso: string): string {
  return format(new Date(iso), "yyyy-MM-dd");
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, "EEE d MMM yyyy");
}

function Ref({ id, numbers }: { id: string; numbers: Record<string, number> }) {
  const n = numbers[id];
  return (
    <Link href={`/snapshots/${id}`} className="rounded font-mono font-semibold text-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
      #{n ?? "?"}
    </Link>
  );
}

function Actor({ id, people }: { id: string; people: People }) {
  return <span className="font-medium text-foreground">{personOf(people, id).displayName}</span>;
}

function Quote({ text }: { text: string }) {
  return <blockquote className="mt-1 border-l-2 border-border pl-2 text-muted-foreground italic">“{text}”</blockquote>;
}

function TransitionLine({ t, numbers, people }: { t: TransitionRow; numbers: Record<string, number>; people: People }) {
  const comment = t.comment && !/^(Superseded by|Rolled back)/.test(t.comment) ? t.comment : null;
  return (
    <div>
      <p className="text-muted-foreground">
        <Actor id={t.actor_id} people={people} /> {ACTION_VERBS[t.action]} <Ref id={t.snapshot_id} numbers={numbers} />
        {t.related_snapshot_id && t.action === "supersede" && (
          <>
            {" "}
            by <Ref id={t.related_snapshot_id} numbers={numbers} />
          </>
        )}
        {t.related_snapshot_id && t.action === "reactivate" && (
          <>
            {" "}
            — rolled back from <Ref id={t.related_snapshot_id} numbers={numbers} />
          </>
        )}
        {t.related_snapshot_id && t.action === "create" && (
          <>
            {" "}
            from <Ref id={t.related_snapshot_id} numbers={numbers} />
          </>
        )}
      </p>
      {t.action !== "create" && t.from_state && (
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <StateBadge state={t.from_state} size="xs" short showCode={false} className="opacity-70" />
          <ArrowRight className="size-3 text-muted-foreground" />
          <StateBadge state={t.to_state} size="xs" short showCode={false} />
        </div>
      )}
      {comment && <Quote text={comment} />}
    </div>
  );
}

const EVENT_META = {
  created: { verb: "created the procedure", icon: Sparkles },
  retired: { verb: "retired the procedure", icon: Archive },
  restored: { verb: "restored the procedure", icon: ArchiveRestore },
  working_copy_discarded: { verb: "discarded a working copy", icon: Eraser },
} as const;

function EventLine({ e, people }: { e: ProcedureEventRow; people: People }) {
  const meta = EVENT_META[e.kind];
  const Icon = meta.icon;
  const number = typeof e.detail?.number === "number" ? ` #${e.detail.number}` : "";
  return (
    <div>
      <p className="text-muted-foreground">
        <Actor id={e.actor_id} people={people} /> {meta.verb}
        {e.kind === "working_copy_discarded" ? number : ""}
        <Icon className={cn("ml-1.5 inline size-3 align-[-1px]", e.kind === "retired" && "text-tone-danger")} />
      </p>
      {e.reason && <Quote text={e.reason} />}
    </div>
  );
}
