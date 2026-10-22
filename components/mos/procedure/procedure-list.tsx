"use client";

import Link from "next/link";
import { motion, MotionConfig } from "motion/react";
import { AlertTriangle, ChevronLeft, ChevronRight, CircleSlash, FilePlus2, Pencil, SearchX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/mos/page-header";
import { SnapshotRef } from "@/components/mos/hash";
import { RelativeTime } from "@/components/mos/time";
import { TONE_CLASSES } from "@/components/mos/state-badge";
import { STATE_META, type Tone } from "@/lib/lifecycle";
import { cn } from "@/lib/utils";
import type { ProcedureOverview } from "@/lib/data/types";
import { useProcedureFilters } from "./procedure-filters";
import { PAGE_SIZE } from "./search-params";

const GRID = "lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1.1fr)_minmax(0,1.3fr)_7.5rem]";

export function ProcedureList({ rows, count, page, filtered, canCreate }: { rows: ProcedureOverview[]; count: number; page: number; filtered: boolean; canCreate: boolean }) {
  const { setState } = useProcedureFilters();

  if (rows.length === 0) {
    return filtered ? (
      <EmptyState icon={<SearchX />} title="No procedures match these filters">
        Try a broader search, or clear the filters. Retired procedures are hidden unless you pick the Retired filter.
        <div className="mt-3">
          <Button variant="outline" size="sm" onClick={() => void setState({ q: "", mission: null, area: null, status: [], page: 1 })}>
            Clear filters
          </Button>
        </div>
      </EmptyState>
    ) : (
      <EmptyState icon={<FilePlus2 />} title="No procedures yet">
        Procedures are single Python files that drive the satellite. Each one moves through review, test and approval; the approved snapshot is what PROD runs.
        {canCreate ? " Use New procedure to write the first one." : " Ask someone with the author role to create the first one."}
      </EmptyState>
    );
  }

  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  return (
    <MotionConfig reducedMotion="user">
      <div className="overflow-hidden rounded-xl border bg-card/40">
        <div className={cn("hidden items-center gap-4 border-b bg-muted/30 px-4 py-2 text-xs font-medium text-muted-foreground lg:grid", GRID)}>
          <span>Procedure</span>
          <span>In PROD</span>
          <span>Pipeline</span>
          <span className="text-right">Last activity</span>
        </div>
        <ul className="divide-y">
          {rows.map((p, i) => (
            <motion.li
              key={p.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, delay: Math.min(i, 10) * 0.025, ease: "easeOut" }}
            >
              <ProcedureRow p={p} />
            </motion.li>
          ))}
        </ul>
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
        <span className="tabular">
          {(page - 1) * PAGE_SIZE + 1}–{(page - 1) * PAGE_SIZE + rows.length} of {count}
        </span>
        {pages > 1 && (
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon-sm" aria-label="Previous page" disabled={page <= 1} onClick={() => void setState({ page: page - 1 })}>
              <ChevronLeft />
            </Button>
            <span className="tabular px-2">
              {page} / {pages}
            </span>
            <Button variant="outline" size="icon-sm" aria-label="Next page" disabled={page >= pages} onClick={() => void setState({ page: page + 1 })}>
              <ChevronRight />
            </Button>
          </div>
        )}
      </div>
    </MotionConfig>
  );
}

function ProcedureRow({ p }: { p: ProcedureOverview }) {
  const retired = !!p.retired_at;
  return (
    <div className={cn("group relative grid gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-muted/40 focus-within:bg-muted/40", GRID, "lg:items-center", retired && "opacity-90")}>
      {/* name */}
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Link
            href={`/procedures/${p.id}`}
            title={p.name}
            className="truncate font-mono text-[13px] font-medium outline-none after:absolute after:inset-0 after:content-[''] focus-visible:underline"
          >
            {p.name}
          </Link>
          {retired && (
            <Badge variant="outline" className="text-tone-muted">
              Retired
            </Badge>
          )}
        </div>
        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded border px-1 font-mono text-[10px] leading-4">{p.mission}</span>
          {p.folder && <span className="truncate font-mono">{p.folder}</span>}
          {p.description && <span className="hidden truncate xl:inline">· {p.description}</span>}
        </div>
      </div>

      {/* PROD */}
      <div className="min-w-0 text-xs">
        <ProdCell p={p} />
      </div>

      {/* pipeline */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Pipeline p={p} />
      </div>

      {/* activity */}
      <div className="text-xs text-muted-foreground lg:text-right">
        <RelativeTime date={p.last_activity_at} />
        <div className="tabular text-[11px] opacity-70">
          {p.total_snapshots} snapshot{p.total_snapshots === 1 ? "" : "s"}
        </div>
      </div>
    </div>
  );
}

function ProdCell({ p }: { p: ProcedureOverview }) {
  const retired = !!p.retired_at;
  if (p.active_snapshot_id && p.active_number != null) {
    return (
      <div className={cn("flex items-center gap-2", retired && "text-muted-foreground")}>
        <span className={cn("size-2 shrink-0 rounded-full", retired ? "bg-tone-warn" : cn(TONE_CLASSES.success.dot, "animate-pulse-ring text-tone-success"))} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Link href={`/snapshots/${p.active_snapshot_id}`} className={cn("relative z-10 rounded outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring", retired && "line-through decoration-1")}>
              <SnapshotRef number={p.active_number} sha={p.active_sha256} />
            </Link>
            {retired && (
              <span className="inline-flex items-center gap-1 text-tone-warn">
                <AlertTriangle className="size-3" /> not available
              </span>
            )}
          </div>
          {p.active_since && (
            <div className="text-[11px] text-muted-foreground">
              since <RelativeTime date={p.active_since} addSuffix />
            </div>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 text-muted-foreground">
      <CircleSlash className="size-3.5 shrink-0" />
      <span>{retired ? "Retired — nothing in PROD" : "Nothing in PROD"}</span>
    </div>
  );
}

function PipelineChip({ tone, count, label, state }: { tone: Tone; count: number; label: string; state: keyof typeof STATE_META }) {
  const t = TONE_CLASSES[tone];
  return (
    <span title={`${count} ${label.toLowerCase()} — ${STATE_META[state].description}`} className={cn("inline-flex h-5 items-center gap-1.5 rounded-md border px-1.5 text-[11px] font-medium whitespace-nowrap", t.text, t.bg, t.border)}>
      <span className="tabular font-mono font-semibold">{count}</span>
      {label}
    </span>
  );
}

function Pipeline({ p }: { p: ProcedureOverview }) {
  const empty = !p.in_review && !p.in_test && !p.awaiting_approval && !p.working_copies;
  if (empty) return <span className="text-xs text-muted-foreground">Nothing in flight</span>;
  return (
    <>
      {p.in_review > 0 && <PipelineChip tone={STATE_META.ready_for_review.tone} count={p.in_review} label="In review" state="ready_for_review" />}
      {p.in_test > 0 && <PipelineChip tone={STATE_META.test_in_progress.tone} count={p.in_test} label="In test" state="test_in_progress" />}
      {p.awaiting_approval > 0 && <PipelineChip tone={STATE_META.approval_pending.tone} count={p.awaiting_approval} label="Awaiting approval" state="approval_pending" />}
      {p.working_copies > 0 && (
        <span title={`${p.working_copies} working ${p.working_copies === 1 ? "copy" : "copies"} being edited`} className="inline-flex h-5 items-center gap-1 rounded-md border border-dashed px-1.5 text-[11px] text-muted-foreground">
          <Pencil className="size-3" />
          <span className="tabular font-mono font-semibold">{p.working_copies}</span>
          editing
        </span>
      )}
    </>
  );
}
