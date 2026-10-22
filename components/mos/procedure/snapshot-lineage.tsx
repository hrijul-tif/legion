"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { motion, MotionConfig } from "motion/react";
import { GitBranch, PencilLine } from "lucide-react";
import { SnapshotRef } from "@/components/mos/hash";
import { StateBadge } from "@/components/mos/state-badge";
import { RelativeTime } from "@/components/mos/time";
import { UserAvatar } from "@/components/mos/user-avatar";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { STATE_META, type Tone } from "@/lib/lifecycle";
import { cn } from "@/lib/utils";
import type { SnapshotListRow } from "@/lib/data/types";

const ROW_H = 64;
const COL_W = 18;
const PAD = 14;
const MAX_COLS = 6;

const NODE_TONE: Record<Tone, string> = {
  neutral: "text-tone-neutral",
  info: "text-tone-info",
  progress: "text-tone-progress",
  warn: "text-tone-warn",
  success: "text-tone-success",
  danger: "text-tone-danger",
  muted: "text-tone-muted",
};

/** Assign each snapshot a graph column: first child continues its parent's column, later forks open a new one. */
function assignColumns(rows: SnapshotListRow[]): Map<string, number> {
  const ids = new Set(rows.map((r) => r.id));
  const cols = new Map<string, number>();
  const claimed = new Set<string>();
  let next = 0;
  for (const r of [...rows].sort((a, b) => a.number - b.number)) {
    const p = r.parent_snapshot_id && ids.has(r.parent_snapshot_id) ? r.parent_snapshot_id : null;
    if (p && !claimed.has(p)) {
      claimed.add(p);
      cols.set(r.id, cols.get(p) ?? 0);
    } else {
      cols.set(r.id, Math.min(next++, MAX_COLS - 1));
    }
  }
  return cols;
}

export function SnapshotLineage({ snapshots, currentUserId }: { snapshots: SnapshotListRow[]; currentUserId: string }) {
  const [hideWip, setHideWip] = useState(false);
  const rows = useMemo(() => (hideWip ? snapshots.filter((s) => s.state !== "in_progress") : snapshots), [snapshots, hideWip]);
  const cols = useMemo(() => assignColumns(rows), [rows]);
  const colCount = Math.max(1, ...[...cols.values()].map((c) => c + 1));
  const gutter = PAD * 2 + (colCount - 1) * COL_W;
  const index = new Map(rows.map((r, i) => [r.id, i]));
  const x = (id: string) => PAD + (cols.get(id) ?? 0) * COL_W;
  const y = (i: number) => i * ROW_H + ROW_H / 2;
  const wipCount = snapshots.filter((s) => s.state === "in_progress").length;

  return (
    <section aria-labelledby="lineage-heading" className="rounded-2xl border bg-card/50">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3">
        <div>
          <h2 id="lineage-heading" className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <GitBranch className="size-4 text-muted-foreground" /> Snapshots
            <span className="tabular rounded-md bg-muted px-1.5 font-mono text-[11px] font-normal text-muted-foreground">{snapshots.length}</span>
          </h2>
          <p className="text-xs text-muted-foreground">Newest first. Lines show which snapshot each one was forked from.</p>
        </div>
        {wipCount > 0 && (
          <div className="flex items-center gap-2">
            <Switch id="hide-wip" size="sm" checked={hideWip} onCheckedChange={setHideWip} />
            <Label htmlFor="hide-wip" className="text-xs font-normal text-muted-foreground">
              Hide working copies ({wipCount})
            </Label>
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-muted-foreground">No snapshots yet.</p>
      ) : (
        <MotionConfig reducedMotion="user">
          <div className="relative">
            <svg aria-hidden className="pointer-events-none absolute top-0 left-0 z-10 overflow-visible" width={gutter} height={rows.length * ROW_H}>
              {rows.map((r, i) => {
                const pIdx = r.parent_snapshot_id ? index.get(r.parent_snapshot_id) : undefined;
                if (pIdx === undefined) return null;
                const cx = x(r.id);
                const px = x(r.parent_snapshot_id!);
                const yi = y(i);
                const yj = y(pIdx);
                const d =
                  cx === px
                    ? `M ${cx} ${yi} V ${yj}`
                    : (() => {
                        const R = Math.min(8, Math.abs(px - cx));
                        const s = Math.sign(px - cx);
                        return `M ${cx} ${yi} V ${yj - R} Q ${cx} ${yj} ${cx + s * R} ${yj} H ${px}`;
                      })();
                return <path key={r.id} d={d} fill="none" strokeWidth={1.5} className="stroke-muted-foreground/40" />;
              })}
              {rows.map((r, i) => (
                <g key={r.id} className={NODE_TONE[STATE_META[r.state].tone]}>
                  {r.is_active && <circle cx={x(r.id)} cy={y(i)} r={8} className="fill-current opacity-20" />}
                  <circle cx={x(r.id)} cy={y(i)} r={4.5} strokeWidth={2} className={cn("stroke-current", r.is_active ? "fill-current" : "fill-background")} />
                </g>
              ))}
            </svg>

            <ul>
              {rows.map((s, i) => {
                const mineWip = s.state === "in_progress" && s.author_id === currentUserId;
                return (
                  <motion.li key={s.id} layout="position" initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.18, delay: Math.min(i, 8) * 0.02 }} style={{ height: ROW_H }} className="border-b border-border/50 last:border-0">
                    <Link
                      href={mineWip ? `/snapshots/${s.id}/edit` : `/snapshots/${s.id}`}
                      style={{ paddingLeft: gutter + 8, height: ROW_H }}
                      className={cn("group flex items-center gap-3 pr-5 outline-none transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset")}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <SnapshotRef number={s.number} sha={s.code_sha256} />
                          <StateBadge state={s.state} size="xs" short showCode={false} />
                          {s.parent_number != null && <span className="text-[11px] text-muted-foreground">forked from #{s.parent_number}</span>}
                          {mineWip && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 text-[10px] font-medium text-primary">
                              <PencilLine className="size-3" /> yours
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                          <UserAvatar user={{ displayName: s.author_name, initials: s.author_initials, color: s.author_color }} size={16} />
                          <span className="shrink-0 text-foreground/80">{s.author_name}</span>
                          <span aria-hidden>·</span>
                          <span className={cn("truncate", !s.summary && "italic opacity-70")}>{s.summary || (s.state === "in_progress" ? "Working copy — no change note yet" : "No change note")}</span>
                        </div>
                      </div>
                      <div className="hidden shrink-0 text-right text-[11px] text-muted-foreground sm:block">
                        <div>{s.submitted_at ? "submitted" : "created"}</div>
                        <RelativeTime date={s.submitted_at ?? s.created_at} />
                      </div>
                    </Link>
                  </motion.li>
                );
              })}
            </ul>
          </div>
        </MotionConfig>
      )}
    </section>
  );
}
