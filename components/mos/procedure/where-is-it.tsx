"use client";

import Link from "next/link";
import { AnimatePresence, LayoutGroup, motion, MotionConfig } from "motion/react";
import { formatDistanceStrict } from "date-fns";
import { ArrowRight, Ban, CheckCircle2, ExternalLink, Hourglass, PencilLine, ShieldAlert } from "lucide-react";
import { SnapshotRef } from "@/components/mos/hash";
import { StateBadge, TONE_CLASSES } from "@/components/mos/state-badge";
import { UserAvatar } from "@/components/mos/user-avatar";
import { RelativeTime } from "@/components/mos/time";
import { shortHash, STALE_AFTER_DAYS, STATE_META, type SnapshotState } from "@/lib/lifecycle";
import { cn } from "@/lib/utils";
import type { SnapshotListRow } from "@/lib/data/types";
import { LocalTime } from "./local-time";
import { personOf, type People } from "./people";

export interface ProdApproval {
  actorId: string;
  at: string;
  via: "approve" | "reactivate";
  comment: string | null;
}

interface Props {
  snapshots: SnapshotListRow[];
  people: People;
  currentUserId: string;
  retired: boolean;
  /** Server-provided so stale markers agree between SSR and hydration. */
  nowMs: number;
  approval: ProdApproval | null;
}

const ENV_STYLE = {
  DEV: { tone: "neutral", title: "DEV", sub: "Working copies" },
  TEST: { tone: "progress", title: "TEST", sub: "Review, test and approval" },
  PROD: { tone: "success", title: "PROD", sub: "What flight runs" },
} as const;

const spring = { type: "spring", stiffness: 420, damping: 38, mass: 0.8 } as const;

export function WhereIsIt({ snapshots, people, currentUserId, retired, nowMs, approval }: Props) {
  const dev = snapshots.filter((s) => STATE_META[s.state].env === "DEV").sort((a, b) => +new Date(b.updated_at) - +new Date(a.updated_at));
  const test = snapshots.filter((s) => STATE_META[s.state].env === "TEST").sort((a, b) => +new Date(since(b)) - +new Date(since(a)));
  const active = snapshots.find((s) => s.is_active) ?? null;
  const offline = snapshots.filter((s) => STATE_META[s.state].env === null);
  const failed = offline.filter((s) => s.state === "review_failed" || s.state === "test_failed" || s.state === "approval_failed");

  return (
    <section aria-labelledby="where-heading" className="relative overflow-hidden rounded-2xl border bg-card/50">
      <div aria-hidden className="bg-grid pointer-events-none absolute inset-0 opacity-60 [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_80%)]" />
      <div className="relative">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-4">
          <div>
            <h2 id="where-heading" className="text-sm font-semibold tracking-tight">
              Where is it?
            </h2>
            <p className="text-xs text-muted-foreground">Every live snapshot of this procedure, by environment. Moves animate as they happen.</p>
          </div>
        </div>

        <MotionConfig reducedMotion="user" transition={spring}>
          <LayoutGroup id="lanes">
            <div className="grid gap-3 p-4 md:grid-cols-[1fr_auto_1fr_auto_1.25fr] md:items-stretch md:gap-2">
              <Lane env="DEV" count={dev.length}>
                <AnimatePresence initial={false} mode="popLayout">
                  {dev.map((s) => (
                    <LaneItem key={s.id} id={s.id}>
                      <DevCard s={s} people={people} mine={s.author_id === currentUserId} />
                    </LaneItem>
                  ))}
                </AnimatePresence>
                {dev.length === 0 && <LaneEmpty icon={<PencilLine />}>No working copies. Nobody is editing this procedure.</LaneEmpty>}
              </Lane>

              <FlowArrow />

              <Lane env="TEST" count={test.length}>
                <AnimatePresence initial={false} mode="popLayout">
                  {test.map((s) => (
                    <LaneItem key={s.id} id={s.id}>
                      <TestCard s={s} people={people} nowMs={nowMs} />
                    </LaneItem>
                  ))}
                </AnimatePresence>
                {test.length === 0 && <LaneEmpty icon={<Hourglass />}>Nothing waiting for review, test or approval.</LaneEmpty>}
              </Lane>

              <FlowArrow />

              <Lane env="PROD" count={active && !retired ? 1 : 0} emphasis>
                <AnimatePresence initial={false} mode="popLayout">
                  {active && (
                    <LaneItem key={active.id} id={active.id}>
                      <ProdCard s={active} people={people} retired={retired} approval={approval} />
                    </LaneItem>
                  )}
                </AnimatePresence>
                {!active && (
                  <LaneEmpty icon={<ShieldAlert />} tone="warn" strong>
                    <span className="block font-medium text-foreground">Nothing approved</span>
                    PROD cannot run this procedure until a snapshot is approved.
                  </LaneEmpty>
                )}
              </Lane>
            </div>
          </LayoutGroup>
        </MotionConfig>

        {offline.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t bg-background/40 px-5 py-2.5 text-xs text-muted-foreground">
            <span>
              Not in any environment: <span className="tabular font-medium text-foreground">{offline.length}</span> ({countBy(offline)})
            </span>
            {failed.length > 0 && (
              <span className="flex flex-wrap items-center gap-1.5">
                Needs the author:
                {failed.slice(0, 6).map((s) => (
                  <Link key={s.id} href={`/snapshots/${s.id}`} className="inline-flex items-center gap-1 rounded-md outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
                    <span className="font-mono font-semibold text-foreground">#{s.number}</span>
                    <span className={TONE_CLASSES.danger.text}>{STATE_META[s.state].short.toLowerCase()}</span>
                  </Link>
                ))}
              </span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function since(s: SnapshotListRow): string {
  return s.state_changed_at ?? s.updated_at;
}

function countBy(list: SnapshotListRow[]): string {
  const counts = new Map<SnapshotState, number>();
  for (const s of list) counts.set(s.state, (counts.get(s.state) ?? 0) + 1);
  return [...counts.entries()].map(([st, n]) => `${n} ${STATE_META[st].short.toLowerCase()}`).join(", ");
}

function Lane({ env, count, emphasis, children }: { env: keyof typeof ENV_STYLE; count: number; emphasis?: boolean; children: React.ReactNode }) {
  const m = ENV_STYLE[env];
  const tone = TONE_CLASSES[m.tone];
  return (
    <div className={cn("flex min-h-44 flex-col rounded-xl border bg-background/60 backdrop-blur-sm", emphasis && "border-tone-success/30 bg-tone-success/[0.04]")}>
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <span className={cn("size-2 rounded-full", tone.dot, env === "PROD" && count > 0 && "animate-pulse-ring", tone.text)} />
        <span className={cn("font-mono text-xs font-semibold tracking-wider", tone.text)}>{m.title}</span>
        <span className="truncate text-xs text-muted-foreground">{m.sub}</span>
        <span className="tabular ml-auto rounded-md bg-muted px-1.5 font-mono text-[11px] text-muted-foreground">{count}</span>
      </div>
      <div className="relative flex flex-1 flex-col gap-2 p-2">{children}</div>
    </div>
  );
}

function FlowArrow() {
  return (
    <div aria-hidden className="hidden items-center text-muted-foreground/50 md:flex">
      <ArrowRight className="size-4" />
    </div>
  );
}

function LaneItem({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <motion.div layout="position" layoutId={`snap-${id}`} initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}>
      {children}
    </motion.div>
  );
}

function LaneEmpty({ icon, children, tone, strong }: { icon: React.ReactNode; children: React.ReactNode; tone?: "warn"; strong?: boolean }) {
  return (
    <div className={cn("flex flex-1 flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground [&_svg]:size-5", tone === "warn" && "border-tone-warn/30 bg-tone-warn/[0.04]", strong && "py-10")}>
      <span className={tone === "warn" ? "text-tone-warn" : undefined}>{icon}</span>
      <div>{children}</div>
    </div>
  );
}

function DevCard({ s, people, mine }: { s: SnapshotListRow; people: People; mine: boolean }) {
  const author = personOf(people, s.author_id);
  return (
    <Link
      href={mine ? `/snapshots/${s.id}/edit` : `/snapshots/${s.id}`}
      className={cn("group block rounded-lg border bg-card px-3 py-2 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring", mine && "border-primary/30")}
    >
      <div className="flex items-center justify-between gap-2">
        <SnapshotRef number={s.number} />
        {mine ? <span className="rounded-full bg-primary/10 px-1.5 text-[10px] font-medium text-primary">yours · continue</span> : <span className="text-[10px] text-muted-foreground">read-only</span>}
      </div>
      <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
        <UserAvatar user={author} size={18} />
        <span className="truncate text-foreground">{author.displayName}</span>
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground">
        edited <RelativeTime date={s.updated_at} />
        {s.parent_number != null && <span> · from #{s.parent_number}</span>}
      </div>
    </Link>
  );
}

function TestCard({ s, people, nowMs }: { s: SnapshotListRow; people: People; nowMs: number }) {
  const author = personOf(people, s.author_id);
  const sinceIso = since(s);
  const ageDays = (nowMs - Date.parse(sinceIso)) / 86_400_000;
  const stale = ageDays > STALE_AFTER_DAYS;
  return (
    <Link
      href={`/snapshots/${s.id}`}
      className={cn("block rounded-lg border bg-card px-3 py-2 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring", stale && "border-tone-warn/40")}
    >
      <div className="flex items-center justify-between gap-2">
        <SnapshotRef number={s.number} sha={s.code_sha256} />
        <StateBadge state={s.state} size="xs" short showCode={false} />
      </div>
      {s.summary && <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">{s.summary}</p>}
      <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="flex min-w-0 items-center gap-1.5">
          <UserAvatar user={author} size={16} />
          <span className="truncate">{author.displayName}</span>
        </span>
        <span className={cn("shrink-0 tabular", stale && "font-medium text-tone-warn")} title={`In ${STATE_META[s.state].label} since ${new Date(sinceIso).toISOString()}`}>
          {stale && <span className="mr-1 rounded bg-tone-warn/15 px-1 py-px text-[10px] tracking-wide uppercase">stale</span>}
          {formatDistanceStrict(new Date(sinceIso), new Date(nowMs))}
        </span>
      </div>
    </Link>
  );
}

function ProdCard({ s, people, retired, approval }: { s: SnapshotListRow; people: People; retired: boolean; approval: ProdApproval | null }) {
  const approver = approval ? personOf(people, approval.actorId) : null;
  if (retired) {
    return (
      <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-4 opacity-80">
        <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-tone-warn/30 bg-tone-warn/10 px-2 py-0.5 text-xs font-medium text-tone-warn">
          <Ban className="size-3" /> Retired — not available
        </div>
        <div className="text-muted-foreground grayscale">
          <div className="font-mono text-2xl font-semibold line-through decoration-1">#{s.number}</div>
          <div className="font-mono text-xs">{shortHash(s.code_sha256)}</div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">PROD cannot run this procedure. Restoring it brings #{s.number} back.</p>
        <Link href={`/snapshots/${s.id}`} className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline">
          View snapshot <ExternalLink className="size-3" />
        </Link>
      </div>
    );
  }
  return (
    <Link
      href={`/snapshots/${s.id}`}
      className="group relative block overflow-hidden rounded-lg border border-tone-success/40 bg-gradient-to-br from-tone-success/15 via-card to-card px-4 py-4 outline-none transition-colors hover:border-tone-success/70 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-tone-success">
          <CheckCircle2 className="size-3.5" /> Active in PROD
        </span>
        <ExternalLink className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
      <div className="mt-2 flex items-baseline gap-3 font-mono">
        <span className="text-4xl leading-none font-semibold tracking-tight tabular">#{s.number}</span>
        <span className="rounded-md bg-muted px-1.5 py-0.5 text-sm text-muted-foreground" title={s.code_sha256 ?? undefined}>
          {shortHash(s.code_sha256)}
        </span>
      </div>
      {s.summary && <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{s.summary}</p>}
      {approval && approver && (
        <div className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 border-t pt-2.5 text-xs text-muted-foreground">
          <UserAvatar user={approver} size={18} />
          <span className="text-foreground">{approver.displayName}</span>
          <span>{approval.via === "reactivate" ? "reactivated (rollback)" : "approved"}</span>
          <LocalTime date={approval.at} fmt="d MMM, HH:mm" />
          <span className="text-muted-foreground/70">
            (<RelativeTime date={approval.at} />)
          </span>
        </div>
      )}
    </Link>
  );
}
