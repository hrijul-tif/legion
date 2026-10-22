"use client";

import { useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowRight, Columns2, Maximize2, MessageSquarePlus, Rows2, Target, WrapText, X } from "lucide-react";
import { DiffViewer, type DiffViewerHandle, type ZoneSpec } from "@/components/mos/code/diff-viewer";
import { lineDiffStats } from "@/components/mos/code/diff-stats";
import { RelativeTime } from "@/components/mos/time";
import { UserAvatar } from "@/components/mos/user-avatar";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import type { SnapshotPageData } from "@/lib/data/snapshot";
import type { ReviewComment } from "@/lib/data/types";
import { activeSibling, isFrozen, parentSibling, person } from "./derive";
import { useCompareCode } from "./compare";
import { commentMarkers } from "./code-tab";
import { CommentComposer, CommentItem, CommentThread, useCommentActions, type CommentActions } from "./comments";
import { ReviewerChecklist, StaticAnalysis } from "./review-extras";
import { EmptyNote, SectionCard } from "./bits";

/** Compare selector values: "parent" | "active" | "none" | <snapshot id>. */
export type CompareValue = string;

interface Target {
  id: string | null;
  label: string;
  note?: string;
}

function resolveTarget(d: SnapshotPageData, value: CompareValue): Target {
  const parent = parentSibling(d);
  const active = activeSibling(d);
  if (value === "parent") {
    return parent
      ? { id: parent.id, label: `#${parent.number} (parent)` }
      : { id: null, label: "nothing", note: d.snapshot.parent_snapshot_id ? "The parent is still a working copy, so there is nothing frozen to compare with." : "This snapshot has no parent — everything is shown as new." };
  }
  if (value === "active") {
    if (!active) return { id: null, label: "nothing", note: "No snapshot is active in PROD yet." };
    if (active.id === d.snapshot.id) return { id: null, label: "nothing", note: "This snapshot is the one active in PROD." };
    return { id: active.id, label: `#${active.number} (active in PROD)` };
  }
  if (value === "none") return { id: null, label: "nothing" };
  const other = d.siblings.find((s) => s.id === value && s.id !== d.snapshot.id);
  return other ? { id: other.id, label: `#${other.number}` } : { id: null, label: "nothing", note: "That snapshot isn’t available." };
}

export function ReviewTab({
  data,
  compare,
  onCompareChange,
  focusLine,
  onFocusLine,
}: {
  data: SnapshotPageData;
  compare: CompareValue;
  onCompareChange: (v: CompareValue) => void;
  focusLine: number | null;
  onFocusLine: (line: number | null) => void;
}) {
  const [sideBySide, setSideBySide] = useState(true);
  const [wrap, setWrap] = useState(false);
  const target = useMemo(() => resolveTarget(data, compare), [data, compare]);
  const cmp = useCompareCode(target.id);
  const loading = target.id !== null && cmp?.status !== "ready";
  const fetched = cmp?.status === "ready" && cmp.result.ok ? cmp.result.data.code : null;
  const failed = cmp?.status === "ready" && !cmp.result.ok ? cmp.result.error : null;
  // While the next target loads, keep showing the previous diff (dimmed) instead of flashing a skeleton.
  const [lastGood, setLastGood] = useState<{ id: string | null; code: string; label: string } | null>(null);
  const resolved = target.id === null ? { id: null, code: "", label: target.label } : fetched !== null ? { id: target.id, code: fetched, label: target.label } : null;
  if (resolved && (lastGood?.id !== resolved.id || lastGood.code !== resolved.code || lastGood.label !== resolved.label)) setLastGood(resolved);
  const shown = resolved ?? lastGood;
  const handle = useRef<DiffViewerHandle>(null);
  const actions = useCommentActions(data.snapshot.id);

  const parent = parentSibling(data);
  const active = activeSibling(data);
  const others = data.siblings.filter((s) => isFrozen(s.state) && s.id !== data.snapshot.id && s.id !== parent?.id && s.id !== active?.id);

  const jump = (line: number) => {
    onFocusLine(line);
    handle.current?.revealLine(line);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-muted-foreground">Compare</span>
          <Select value={compare} onValueChange={onCompareChange}>
            <SelectTrigger size="sm" className="h-8 min-w-56 text-[13px]" aria-label="Compare against">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="start">
              <SelectGroup>
                <SelectLabel>Suggested</SelectLabel>
                <SelectItem value="parent" disabled={!parent}>
                  Parent{parent ? ` — #${parent.number}` : " (none)"}
                </SelectItem>
                <SelectItem value="active" disabled={!active || active.id === data.snapshot.id}>
                  Active in PROD{active && active.id !== data.snapshot.id ? ` — #${active.number}` : " (none)"}
                </SelectItem>
                <SelectItem value="none">Nothing (show as new file)</SelectItem>
              </SelectGroup>
              {others.length > 0 && (
                <>
                  <SelectSeparator />
                  <SelectGroup>
                    <SelectLabel>Other snapshots</SelectLabel>
                    {others.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        #{s.number} · {s.summary ? s.summary.slice(0, 38) : s.state}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </>
              )}
            </SelectContent>
          </Select>
          <ArrowRight className="size-3.5 text-muted-foreground" />
          <span className="inline-flex items-center gap-1.5 font-mono text-[13px] font-semibold">#{data.snapshot.number}</span>
          <span className="text-[13px] text-muted-foreground">(this)</span>
        </div>

        <div className="flex items-center gap-1.5">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={sideBySide ? "split" : "inline"}
            onValueChange={(v) => v && setSideBySide(v === "split")}
            aria-label="Diff layout"
          >
            <ToggleGroupItem value="split" aria-label="Side by side">
              <Columns2 /> Side by side
            </ToggleGroupItem>
            <ToggleGroupItem value="inline" aria-label="Inline">
              <Rows2 /> Inline
            </ToggleGroupItem>
          </ToggleGroup>
          <Toggle size="sm" variant="outline" pressed={wrap} onPressedChange={setWrap} aria-label="Toggle word wrap">
            <WrapText /> Wrap
          </Toggle>
        </div>
      </div>

      {target.note && (
        <p className="rounded-lg border border-dashed px-3 py-2 text-[13px] text-muted-foreground" role="note">
          {target.note}
        </p>
      )}

      <div className={cn("transition-opacity duration-200", loading && shown && "opacity-60")}>
        {failed ? (
          <EmptyNote icon={<AlertCircle />} title="Couldn’t load the other snapshot">
            {failed}
          </EmptyNote>
        ) : !shown ? (
          <DiffSkeleton />
        ) : (
          <DiffSection
            data={data}
            original={shown.code}
            hasTarget={shown.id !== null}
            targetLabel={shown.label}
            sideBySide={sideBySide}
            wrap={wrap}
            focusLine={focusLine}
            onFocusLine={onFocusLine}
            handle={handle}
            actions={actions}
          />
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="space-y-4">
          <Discussion data={data} actions={actions} onJump={jump} />
          <StaticAnalysis code={data.code} mission={data.procedure.mission} onJump={jump} />
        </div>
        <ReviewerChecklist />
      </div>
    </div>
  );
}

function DiffSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-6 w-64" />
      <Skeleton className="h-[460px] w-full rounded-xl" />
    </div>
  );
}

/* ---------------------------------------------------------------- diff pane */

function DiffSection({
  data,
  original,
  hasTarget,
  targetLabel,
  sideBySide,
  wrap,
  focusLine,
  onFocusLine,
  handle,
  actions,
}: {
  data: SnapshotPageData;
  original: string;
  hasTarget: boolean;
  targetLabel: string;
  sideBySide: boolean;
  wrap: boolean;
  focusLine: number | null;
  onFocusLine: (l: number | null) => void;
  handle: React.RefObject<DiffViewerHandle | null>;
  actions: CommentActions;
}) {
  const canComment = data.snapshot.state !== "in_progress";
  const [composer, setComposer] = useState<number | null>(null);
  const [hideOverride, setHideOverride] = useState<boolean | null>(null);

  const stats = useMemo(() => lineDiffStats(original, data.code), [original, data.code]);
  const identical = stats.added === 0 && stats.removed === 0 && hasTarget;
  const markers = useMemo(() => commentMarkers(data), [data]);

  // Collapsing unchanged regions would hide comments that sit on unchanged lines, so default to the full file then.
  const commentsOutsideChanges = useMemo(() => {
    const changed = new Set(stats.changedNewLines);
    return data.comments.some((c) => {
      if (c.line == null) return false;
      for (let l = c.line - 4; l <= c.line + 4; l++) if (changed.has(l)) return false;
      return true;
    });
  }, [stats, data.comments]);
  const autoHide = !commentsOutsideChanges && !identical && hasTarget;
  const hideUnchanged = hideOverride ?? autoHide;

  const byLine = useMemo(() => {
    const m = new Map<number, ReviewComment[]>();
    for (const c of data.comments) if (c.line != null) m.set(c.line, [...(m.get(c.line) ?? []), c]);
    return m;
  }, [data.comments]);

  const zones = useMemo<ZoneSpec[]>(() => {
    const z: ZoneSpec[] = [];
    for (const [line, list] of byLine) {
      z.push({
        key: `thread:${line}`,
        afterLine: line,
        node: <CommentThread comments={list} data={data} actions={actions} line={line} canComment={canComment} onReply={() => setComposer(line)} />,
      });
    }
    if (composer != null && canComment) {
      z.push({
        key: `composer:${composer}`,
        afterLine: composer,
        node: (
          <div className="mx-3 my-1.5 rounded-lg border border-primary/40 bg-card p-3 shadow-xs">
            <div className="mb-2 flex items-center gap-2 text-[12px] text-muted-foreground">
              <UserAvatar user={data.me} size={20} />
              <span>
                Commenting on line <span className="font-mono text-foreground">{composer}</span> of #{data.snapshot.number}
              </span>
            </div>
            <CommentComposer
              autoFocus
              placeholder="Say what should change, or ask a question…"
              onSubmit={(body) => actions.add(composer, body)}
              onCancel={() => setComposer(null)}
            />
          </div>
        ),
      });
    }
    return z;
  }, [byLine, composer, canComment, data, actions]);

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-[13px]">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="inline-flex items-center gap-2 font-mono tabular">
            <span className="rounded-md bg-tone-success/10 px-1.5 py-0.5 font-semibold text-tone-success">+{stats.added}</span>
            <span className="rounded-md bg-tone-danger/10 px-1.5 py-0.5 font-semibold text-tone-danger">−{stats.removed}</span>
          </span>
          <span className="text-muted-foreground">
            lines changed vs <span className="text-foreground">{targetLabel}</span>
          </span>
          {identical && <span className="text-tone-info">Identical code — nothing to review in the diff.</span>}
          {canComment ? (
            <span className="hidden items-center gap-1.5 text-muted-foreground md:inline-flex">
              <MessageSquarePlus className="size-3.5" /> Click a line number to comment
            </span>
          ) : (
            <span className="text-muted-foreground">Comments open once the snapshot is submitted.</span>
          )}
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 text-muted-foreground">
          <Maximize2 className="size-3.5" />
          Collapse unchanged lines
          <Switch size="sm" checked={hideUnchanged} onCheckedChange={setHideOverride} disabled={identical || !hasTarget} aria-label="Collapse unchanged lines" />
        </label>
      </div>

      {focusLine && (
        <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-1.5 text-[13px]">
          <Target className="size-3.5 text-primary" />
          Focused on line <span className="font-mono">{focusLine}</span>
          <Button variant="ghost" size="icon-xs" className="ml-auto" aria-label="Clear line focus" onClick={() => onFocusLine(null)}>
            <X />
          </Button>
        </div>
      )}

      <div className="h-[min(76dvh,860px)] min-h-[420px] overflow-hidden rounded-xl border bg-card">
        <DiffViewer
          original={original}
          modified={data.code}
          modelKey={data.snapshot.id}
          mission={data.procedure.mission}
          sideBySide={sideBySide}
          hideUnchanged={hideUnchanged}
          wordWrap={wrap}
          zones={zones}
          markers={markers}
          canComment={canComment}
          onRequestComment={(line) => {
            setComposer(line);
            onFocusLine(null);
          }}
          focusLine={focusLine}
          handleRef={handle}
        />
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- discussion */

function Discussion({ data, actions, onJump }: { data: SnapshotPageData; actions: CommentActions; onJump: (line: number) => void }) {
  const canComment = data.snapshot.state !== "in_progress";
  const general = data.comments.filter((c) => c.line == null);
  const lineComments = data.comments.filter((c) => c.line != null).sort((a, b) => (a.line ?? 0) - (b.line ?? 0) || a.created_at.localeCompare(b.created_at));
  const unresolved = data.comments.filter((c) => !c.resolved_at).length;

  return (
    <SectionCard
      title="Discussion"
      actions={
        <span className="text-xs tabular text-muted-foreground">
          {data.comments.length} comment{data.comments.length === 1 ? "" : "s"}
          {unresolved > 0 && <span className="text-tone-warn"> · {unresolved} unresolved</span>}
        </span>
      }
      bodyClassName="space-y-5"
    >
      {lineComments.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-xs font-medium text-muted-foreground">On specific lines</h4>
          <ul className="divide-y rounded-lg border">
            {lineComments.map((c) => {
              const author = person(data, c.author_id);
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onJump(c.line!)}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] outline-none hover:bg-muted/50 focus-visible:bg-muted/60"
                  >
                    <span className={cn("rounded px-1.5 py-0.5 font-mono text-[11px] tabular", c.resolved_at ? "bg-muted text-muted-foreground" : "bg-tone-warn/10 text-tone-warn")}>L{c.line}</span>
                    <UserAvatar user={author} size={18} />
                    <span className={cn("min-w-0 flex-1 truncate", c.resolved_at && "text-muted-foreground line-through decoration-muted-foreground/30")}>{c.body}</span>
                    <RelativeTime date={c.created_at} className="shrink-0 text-xs text-muted-foreground" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="space-y-3">
        <h4 className="text-xs font-medium text-muted-foreground">General comments</h4>
        {general.length === 0 && <p className="text-[13px] text-muted-foreground">No general comments yet.</p>}
        {general.length > 0 && (
          <div className="space-y-3 rounded-lg border p-3">
            {general.map((c) => (
              <CommentItem key={c.id} c={c} data={data} actions={actions} />
            ))}
          </div>
        )}
        {canComment ? (
          <CommentComposer placeholder="Overall thoughts on this snapshot…" submitLabel="Add comment" onSubmit={(body) => actions.add(null, body)} />
        ) : (
          <p className="text-[13px] text-muted-foreground">Comments open once the snapshot is submitted.</p>
        )}
      </div>
    </SectionCard>
  );
}
