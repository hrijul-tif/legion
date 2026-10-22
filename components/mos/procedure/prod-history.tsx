"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { Ban, Clock, History, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { UserAvatar } from "@/components/mos/user-avatar";
import { cn } from "@/lib/utils";
import { prodAt, type ProdHistory, type ProdSegment, type RetiredWindow } from "@/lib/data/prod-history";
import { LocalTime, useMounted } from "./local-time";
import { personOf, type People } from "./people";

const MIN_SPAN_MS = 6 * 3_600_000;

interface Props {
  history: ProdHistory;
  people: People;
  nowMs: number;
  createdAt: string;
}

export function ProdHistoryStrip({ history, people, nowMs, createdAt }: Props) {
  const mounted = useMounted();
  const [at, setAt] = useState("");

  const { start, end } = useMemo(() => {
    const points = [Date.parse(createdAt), ...history.segments.map((s) => Date.parse(s.from)), ...history.retiredWindows.map((w) => Date.parse(w.from))];
    const s = Math.min(...points);
    return { start: Math.min(s, nowMs - MIN_SPAN_MS), end: nowMs };
  }, [history, createdAt, nowMs]);
  const span = end - start;
  const pct = (ms: number) => Math.min(100, Math.max(0, ((ms - start) / span) * 100));

  const instant = at ? new Date(at).getTime() : null;
  const found = instant !== null && !Number.isNaN(instant) ? prodAt(history, instant, nowMs) : null;
  const highlighted = found?.kind === "snapshot" ? found.segment : null;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => start + span * f);
  const empty = history.segments.length === 0 && history.retiredWindows.length === 0;

  return (
    <section aria-labelledby="prod-history-heading" className="rounded-2xl border bg-card/50 p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="prod-history-heading" className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <History className="size-4 text-muted-foreground" /> PROD history
          </h2>
          <p className="text-xs text-muted-foreground">Which snapshot PROD could run, over time. Answers “which version ran?”.</p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="active-at" className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Search className="size-3.5" /> Active at…
          </label>
          <input
            id="active-at"
            type="datetime-local"
            value={at}
            max={mounted ? format(new Date(nowMs), "yyyy-MM-dd'T'HH:mm") : undefined}
            onChange={(e) => setAt(e.target.value)}
            className="h-8 rounded-lg border border-input bg-transparent px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 dark:[color-scheme:dark]"
          />
          {at && (
            <Button variant="ghost" size="icon-sm" aria-label="Clear time" onClick={() => setAt("")}>
              <X />
            </Button>
          )}
        </div>
      </div>

      {empty ? (
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
          <Ban className="size-5 shrink-0" />
          <div>
            Nothing has ever been in PROD for this procedure. Once a snapshot is approved it appears here, and every supersede, rollback, withdrawal and retirement after it.
          </div>
        </div>
      ) : (
        <>
          <div className="relative mt-5">
            <div className="relative h-14 overflow-hidden rounded-lg border bg-muted/20 bg-[repeating-linear-gradient(135deg,transparent_0_6px,color-mix(in_oklch,var(--muted-foreground)_8%,transparent)_6px_7px)]">
              {history.retiredWindows.map((w, i) => (
                <RetiredBar key={i} w={w} left={pct(Date.parse(w.from))} right={pct(w.to ? Date.parse(w.to) : end)} people={people} />
              ))}
              {history.segments.map((s, i) => (
                <SegmentBar
                  key={`${s.snapshotId}-${i}`}
                  s={s}
                  left={pct(Date.parse(s.from))}
                  right={pct(s.to ? Date.parse(s.to) : end)}
                  people={people}
                  highlighted={highlighted === s}
                  dimmed={!!found && highlighted !== s}
                />
              ))}
              {instant !== null && found && found.kind !== "future" && (
                <div aria-hidden className="pointer-events-none absolute inset-y-0 z-20 w-px bg-primary shadow-[0_0_0_2px_color-mix(in_oklch,var(--primary)_25%,transparent)]" style={{ left: `${pct(instant)}%` }} />
              )}
            </div>
            <div className="relative mt-1.5 h-4 text-[10px] text-muted-foreground" aria-hidden>
              {ticks.map((t, i) => (
                <span key={i} className={cn("absolute whitespace-nowrap", i === 0 ? "left-0" : i === ticks.length - 1 ? "right-0" : "-translate-x-1/2")} style={i === 0 || i === ticks.length - 1 ? undefined : { left: `${i * 25}%` }}>
                  {i === ticks.length - 1 ? "now" : <LocalTime date={t} fmt="d MMM" />}
                </span>
              ))}
            </div>
          </div>

          <Legend />
        </>
      )}

      {at && <AtResult found={found} people={people} at={instant} />}
    </section>
  );
}

function Legend() {
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2.5 rounded-sm border border-tone-success/60 bg-tone-success/30" /> Active now
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2.5 rounded-sm border bg-tone-muted/20" /> Was active
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2.5 rounded-sm border border-tone-danger/40 bg-tone-danger/20" /> Retired (unavailable)
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2.5 rounded-sm border border-dashed" /> Nothing in PROD
      </span>
    </div>
  );
}

function SegmentBar({ s, left, right, people, highlighted, dimmed }: { s: ProdSegment; left: number; right: number; people: People; highlighted: boolean; dimmed: boolean }) {
  const live = s.to === null;
  const approver = personOf(people, s.approvedBy);
  const ender = s.endedBy ? personOf(people, s.endedBy) : null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={`/snapshots/${s.snapshotId}`}
          aria-label={`Snapshot #${s.number}, in PROD from ${s.from}${s.to ? ` until ${s.to}` : " until now"}`}
          className={cn(
            "absolute inset-y-1.5 z-10 flex min-w-6 items-center overflow-hidden rounded-md border px-2 font-mono text-xs font-semibold transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring",
            live ? "border-tone-success/60 bg-tone-success/30 text-tone-success hover:bg-tone-success/40" : "border-border bg-tone-muted/20 text-muted-foreground hover:bg-tone-muted/30",
            highlighted && "z-20 border-primary bg-primary/20 text-foreground ring-2 ring-primary",
            dimmed && "opacity-40",
          )}
          style={{ left: `${left}%`, width: `${Math.max(right - left, 0.6)}%` }}
        >
          <span className="truncate">#{s.number}</span>
          {s.resumed && <span className="ml-1 text-[9px] font-normal opacity-70">↻</span>}
        </Link>
      </TooltipTrigger>
      <TooltipContent className="block max-w-xs space-y-1 px-3 py-2" side="top">
        <div className="font-mono text-sm font-semibold">#{s.number}</div>
        <div className="flex items-center gap-1.5">
          <UserAvatar user={approver} size={16} />
          {approver.displayName} {s.resumed ? "back after restore" : s.approvedVia === "reactivate" ? "reactivated (rollback)" : "approved"}
        </div>
        <div className="opacity-80">
          {format(new Date(s.from), "d MMM yyyy, HH:mm")} → {s.to ? format(new Date(s.to), "d MMM yyyy, HH:mm") : "now"}
        </div>
        {s.approvalComment && !s.resumed && <div className="italic opacity-80">“{s.approvalComment}”</div>}
        {s.endReason && (
          <div className="border-t border-background/20 pt-1 opacity-90">
            Ended: {s.endReason}
            {s.endedByRelated && ` by #${s.endedByRelated.number}`}
            {ender && ` · ${ender.displayName}`}
            {s.endComment && <span className="block italic">“{s.endComment}”</span>}
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

function RetiredBar({ w, left, right, people }: { w: RetiredWindow; left: number; right: number; people: People }) {
  const by = personOf(people, w.by);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          tabIndex={0}
          role="img"
          aria-label="Retired window"
          className="absolute inset-y-0 z-0 border-x border-tone-danger/40 bg-tone-danger/10 bg-[repeating-linear-gradient(135deg,transparent_0_5px,color-mix(in_oklch,var(--tone-danger)_25%,transparent)_5px_6px)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{ left: `${left}%`, width: `${Math.max(right - left, 0.6)}%` }}
        >
          <span className="absolute bottom-0.5 left-1 text-[9px] font-medium tracking-wide text-tone-danger uppercase">Retired</span>
        </div>
      </TooltipTrigger>
      <TooltipContent className="block max-w-xs space-y-1 px-3 py-2">
        <div className="font-medium">Retired — PROD unavailable</div>
        <div className="opacity-80">
          {format(new Date(w.from), "d MMM yyyy, HH:mm")} → {w.to ? format(new Date(w.to), "d MMM yyyy, HH:mm") : "still retired"}
        </div>
        <div>
          by {by.displayName}
          {w.reason && <span className="block italic">“{w.reason}”</span>}
        </div>
        {w.to && w.restoredBy && (
          <div className="border-t border-background/20 pt-1">
            Restored by {personOf(people, w.restoredBy).displayName}
            {w.restoreReason && <span className="block italic">“{w.restoreReason}”</span>}
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

function AtResult({ found, people, at }: { found: ReturnType<typeof prodAt> | null; people: People; at: number | null }) {
  if (!found || at === null) return <p className="mt-4 text-xs text-muted-foreground">Enter a valid date and time.</p>;
  const when = <LocalTime date={at} fmt="d MMM yyyy, HH:mm" className="font-medium text-foreground" />;
  let body: React.ReactNode;
  let tone = "border-border";
  if (found.kind === "snapshot") {
    const s = found.segment;
    const approver = personOf(people, s.approvedBy);
    tone = "border-primary/40 bg-primary/5";
    body = (
      <>
        <Clock className="size-4 shrink-0 text-primary" />
        <span>
          At {when}, PROD ran{" "}
          <Link href={`/snapshots/${s.snapshotId}`} className="font-mono font-semibold text-foreground underline-offset-2 hover:underline">
            #{s.number}
          </Link>
          , {s.approvedVia === "reactivate" ? "reactivated" : "approved"} by {approver.displayName} on <LocalTime date={s.from} fmt="d MMM, HH:mm" />.
        </span>
      </>
    );
  } else if (found.kind === "retired") {
    tone = "border-tone-danger/30 bg-tone-danger/5";
    body = (
      <>
        <Ban className="size-4 shrink-0 text-tone-danger" />
        <span>
          At {when} the procedure was <strong>retired</strong> — nothing was available to PROD
          {found.window.reason ? ` (“${found.window.reason}”)` : ""}.
        </span>
      </>
    );
  } else if (found.kind === "future") {
    body = <span>{when} is in the future.</span>;
  } else {
    tone = "border-tone-warn/30 bg-tone-warn/5";
    body = (
      <>
        <Ban className="size-4 shrink-0 text-tone-warn" />
        <span>At {when}, nothing had been approved — PROD could not run this procedure.</span>
      </>
    );
  }
  return <div className={cn("mt-4 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs text-muted-foreground", tone)}>{body}</div>;
}
