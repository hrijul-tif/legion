"use client";

import { ArrowRight, FlaskConical, PlayCircle } from "lucide-react";
import { RelativeTime } from "@/components/mos/time";
import { StateBadge } from "@/components/mos/state-badge";
import { ACTION_VERBS } from "@/lib/lifecycle";
import type { SnapshotPageData } from "@/lib/data/snapshot";
import type { TransitionRow } from "@/lib/data/types";
import { person, snapshotNumber } from "./derive";
import { SnapLink, Who } from "./bits";

export function evidenceCounts(t: TransitionRow): { tests: number; runs: number } {
  const ev = (t.evidence ?? {}) as { test_record_ids?: unknown; run_ids?: unknown };
  return {
    tests: Array.isArray(ev.test_record_ids) ? ev.test_record_ids.length : 0,
    runs: Array.isArray(ev.run_ids) ? ev.run_ids.length : 0,
  };
}

function Related({ t, d }: { t: TransitionRow; d: SnapshotPageData }) {
  if (!t.related_snapshot_id) return null;
  const n = snapshotNumber(d, t.related_snapshot_id);
  if (n == null) return null;
  const sha = d.siblings.find((s) => s.id === t.related_snapshot_id)?.code_sha256;
  const prefix =
    t.action === "create" ? "forked from" : t.action === "supersede" ? "superseded by" : t.action === "approve" || t.action === "reactivate" ? "replacing" : "see";
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      {prefix} <SnapLink id={t.related_snapshot_id} number={n} sha={sha} />
    </span>
  );
}

/** One audit row. Shared by the History tab and the chain of custody. */
export function TransitionItem({ t, d, showSnapshot = false }: { t: TransitionRow; d: SnapshotPageData; showSnapshot?: boolean }) {
  const actor = person(d, t.actor_id);
  const ev = evidenceCounts(t);
  const snapNo = snapshotNumber(d, t.snapshot_id);
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
        <Who user={actor} size={20} />
        <span>{ACTION_VERBS[t.action]}</span>
        {showSnapshot && snapNo != null && <SnapLink id={t.snapshot_id} number={snapNo} />}
        <RelativeTime date={t.created_at} className="text-xs text-muted-foreground" />
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        {t.from_state ? <StateBadge state={t.from_state} size="xs" short showCode={false} /> : <span className="text-muted-foreground">new</span>}
        <ArrowRight className="size-3 text-muted-foreground" />
        <StateBadge state={t.to_state} size="xs" short showCode={false} />
        <Related t={t} d={d} />
        {ev.tests > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-muted-foreground">
            <FlaskConical className="size-3" /> {ev.tests} test case{ev.tests === 1 ? "" : "s"}
          </span>
        )}
        {ev.runs > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-muted-foreground">
            <PlayCircle className="size-3" /> {ev.runs} run{ev.runs === 1 ? "" : "s"}
          </span>
        )}
      </div>
      {t.comment && <blockquote className="border-l-2 pl-3 text-[13px] leading-relaxed whitespace-pre-wrap text-foreground/85">{t.comment}</blockquote>}
    </div>
  );
}
