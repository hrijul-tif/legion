"use client";

import { useId, useMemo } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { ACTIONS, STATE_META, type Availability, type ManualAction, type SnapshotState, type Tone } from "@/lib/lifecycle";

/** What a click on a highlighted edge asks for. `withdraw_guided` is the two-step flow for the active snapshot. */
export type DiagramAction = ManualAction | "withdraw_guided";

export interface DiagramTransition {
  from_state: SnapshotState | null;
  to_state: SnapshotState;
}

export interface LifecycleDiagramProps {
  state: SnapshotState;
  /** The snapshot's own transitions: the path it travelled is drawn emphasised. */
  transitions?: DiagramTransition[];
  /** Moves the current user can make right now (from availableActions). */
  available?: Availability[];
  /** Approver on the active snapshot: the dashed withdraw edge becomes the guided flow. */
  canGuidedWithdraw?: boolean;
  onAction?: (action: DiagramAction) => void;
  compact?: boolean;
  showLegend?: boolean;
  className?: string;
}

type Side = "l" | "r" | "t" | "b";
interface EdgeDef {
  id: string;
  from: SnapshotState;
  to: SnapshotState;
  fs: Side;
  ts: Side;
  fo?: number;
  to_?: number;
  label?: string;
  /** label offset from the curve midpoint */
  ld?: [number, number];
  /** where the label attaches along the curve */
  lat?: "start" | "mid" | "end";
  anchor?: "start" | "middle" | "end";
  action?: DiagramAction;
  system?: boolean;
  dashed?: boolean;
}

const GRID: Record<SnapshotState, [number, number]> = {
  in_progress: [0, 0],
  ready_for_review: [1, 0],
  test_in_progress: [2, 0],
  approval_pending: [3, 0],
  approved: [4, 0],
  superseded: [5, 0],
  withdrawn: [5, 1],
  review_failed: [1, 1],
  test_failed: [2, 1],
  approval_failed: [3, 1],
};

const EDGES: EdgeDef[] = [
  { id: "submit", from: "in_progress", to: "ready_for_review", fs: "r", ts: "l", label: "submit", ld: [0, -9] },
  { id: "review_pass", from: "ready_for_review", to: "test_in_progress", fs: "r", ts: "l", label: "pass review", ld: [0, -9], action: "review_pass" },
  { id: "test_pass", from: "test_in_progress", to: "approval_pending", fs: "r", ts: "l", label: "tests pass", ld: [0, -9], action: "test_pass" },
  { id: "approve", from: "approval_pending", to: "approved", fs: "r", ts: "l", label: "approve", ld: [0, -9], action: "approve" },
  { id: "supersede", from: "approved", to: "superseded", fs: "r", ts: "l", fo: -10, to_: -10, label: "newer wins", ld: [0, -8], system: true },
  { id: "reactivate_c", from: "superseded", to: "approved", fs: "l", ts: "r", fo: 10, to_: 10, label: "rollback", ld: [0, 15], action: "reactivate" },
  { id: "review_fail", from: "ready_for_review", to: "review_failed", fs: "b", ts: "t", label: "fail", ld: [8, 0], anchor: "start", action: "review_fail" },
  { id: "test_fail", from: "test_in_progress", to: "test_failed", fs: "b", ts: "t", fo: -14, to_: -14, label: "fail", ld: [-7, 0], anchor: "end", action: "test_fail" },
  { id: "retest", from: "test_failed", to: "test_in_progress", fs: "t", ts: "b", fo: 14, to_: 14, label: "retest", ld: [7, 0], anchor: "start", action: "retest" },
  { id: "refuse", from: "approval_pending", to: "approval_failed", fs: "b", ts: "t", label: "refuse", ld: [8, 0], anchor: "start", action: "refuse" },
  { id: "send_back", from: "approval_failed", to: "test_in_progress", fs: "t", ts: "b", fo: -34, to_: 34, label: "send back", lat: "start", ld: [-6, -11], anchor: "end", action: "send_back" },
  { id: "withdraw", from: "superseded", to: "withdrawn", fs: "b", ts: "t", fo: -14, to_: -14, label: "withdraw", ld: [-7, 0], anchor: "end", action: "withdraw" },
  { id: "reactivate_d", from: "withdrawn", to: "approved", fs: "l", ts: "b", fo: 12, to_: 34, label: "re-approve", lat: "start", ld: [-8, 11], anchor: "end", action: "reactivate" },
  { id: "withdraw_guided", from: "approved", to: "withdrawn", fs: "b", ts: "l", fo: 8, to_: -12, label: "withdraw…", lat: "end", ld: [-8, -10], anchor: "end", action: "withdraw_guided", dashed: true },
];

interface Dim {
  w: number;
  h: number;
  gx: number;
  gy: number;
  pad: number;
  top: number;
}
const FULL: Dim = { w: 116, h: 52, gx: 60, gy: 68, pad: 14, top: 26 };
const COMPACT: Dim = { w: 46, h: 26, gx: 20, gy: 30, pad: 6, top: 6 };

const NODE_ORDER = Object.keys(GRID) as SnapshotState[];

function nodeBox(d: Dim, s: SnapshotState) {
  const [c, r] = GRID[s];
  const x = d.pad + c * (d.w + d.gx);
  const y = d.top + r * (d.h + d.gy);
  return { x, y, w: d.w, h: d.h, cx: x + d.w / 2, cy: y + d.h / 2 };
}

function anchor(d: Dim, s: SnapshotState, side: Side, off = 0): { x: number; y: number } {
  const b = nodeBox(d, s);
  const k = d.w < 60 ? 0.35 : 1; // compact: shrink offsets
  switch (side) {
    case "r":
      return { x: b.x + b.w, y: b.cy + off * k };
    case "l":
      return { x: b.x, y: b.cy + off * k };
    case "t":
      return { x: b.cx + off * k, y: b.y };
    case "b":
      return { x: b.cx + off * k, y: b.y + b.h };
  }
}

const DIR: Record<Side, [number, number]> = { r: [1, 0], l: [-1, 0], t: [0, -1], b: [0, 1] };

function edgeGeometry(d: Dim, e: EdgeDef) {
  const p1 = anchor(d, e.from, e.fs, e.fo);
  const p2 = anchor(d, e.to, e.ts, e.to_);
  const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const k = Math.max(d.w < 60 ? 8 : 18, dist * 0.42);
  const c1 = { x: p1.x + DIR[e.fs][0] * k, y: p1.y + DIR[e.fs][1] * k };
  const c2 = { x: p2.x + DIR[e.ts][0] * k, y: p2.y + DIR[e.ts][1] * k };
  const mid = { x: (p1.x + 3 * c1.x + 3 * c2.x + p2.x) / 8, y: (p1.y + 3 * c1.y + 3 * c2.y + p2.y) / 8 };
  return { path: `M${p1.x},${p1.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${p2.x},${p2.y}`, mid, p1, p2 };
}

const toneVar = (t: Tone) => `var(--tone-${t})`;
const mixTone = (t: Tone, pct: number, base = "var(--card)") => `color-mix(in oklch, ${toneVar(t)} ${pct}%, ${base})`;

export function LifecycleDiagram({
  state,
  transitions = [],
  available = [],
  canGuidedWithdraw = false,
  onAction,
  compact = false,
  showLegend = !compact,
  className,
}: LifecycleDiagramProps) {
  const reduce = useReducedMotion();
  const uid = useId().replace(/:/g, "");
  const d = compact ? COMPACT : FULL;

  const cols = 6;
  const rows = 2;
  const width = d.pad * 2 + cols * d.w + (cols - 1) * d.gx;
  const height = d.top * (compact ? 1 : 1) + rows * d.h + (rows - 1) * d.gy + (compact ? 6 : 22);

  const { travelled, visited } = useMemo(() => {
    const t = new Set<string>();
    const v = new Set<SnapshotState>([state]);
    for (const tr of transitions) {
      v.add(tr.to_state);
      if (tr.from_state) {
        v.add(tr.from_state);
        t.add(`${tr.from_state}>${tr.to_state}`);
      }
    }
    return { travelled: t, visited: v };
  }, [transitions, state]);

  const availByAction = useMemo(() => new Map(available.map((a) => [a.action as DiagramAction, a])), [available]);
  const meta = STATE_META[state];

  const edgeStatus = (e: EdgeDef): "available" | "blocked" | "travelled" | "idle" => {
    if (e.from === state && e.action) {
      if (e.action === "withdraw_guided") return canGuidedWithdraw ? "available" : "idle";
      const a = availByAction.get(e.action);
      if (a) return a.enabled ? "available" : "blocked";
    }
    return travelled.has(`${e.from}>${e.to}`) ? "travelled" : "idle";
  };

  const cur = nodeBox(d, state);
  const spring = reduce ? { duration: 0 } : { type: "spring" as const, stiffness: 220, damping: 26 };

  // Draw idle edges first, emphasised ones on top.
  const ordered = [...EDGES].sort((a, b) => rank(edgeStatus(a)) - rank(edgeStatus(b)));

  return (
    <figure className={cn("w-full", className)}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className={cn("block h-auto w-full select-none overflow-visible", compact && "max-h-[84px]")}
        role="group"
        aria-label={`Lifecycle: currently ${meta.label} (${meta.code})`}
      >
        <defs>
          <style>{"@keyframes mos-lifecycle-dash { to { stroke-dashoffset: -11; } }"}</style>
          {(["idle", "travelled", "available", "blocked"] as const).map((k) => (
            <marker key={k} id={`${uid}-arrow-${k}`} viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth={compact ? 6 : 7} markerHeight={compact ? 6 : 7} orient="auto-start-reverse">
              <path d="M1 1.5 L8.5 5 L1 8.5 Z" style={{ fill: edgeStroke(k) }} />
            </marker>
          ))}
          <filter id={`${uid}-glow`} x="-40%" y="-60%" width="180%" height="220%">
            <feGaussianBlur stdDeviation="6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* edges */}
        {ordered.map((e, i) => {
          const status = edgeStatus(e);
          const g = edgeGeometry(d, e);
          const action = e.action;
          const clickable = status === "available" && !!onAction && !!action;
          const a = action ? availByAction.get(action) : undefined;
          const title =
            status === "available"
              ? e.action === "withdraw_guided"
                ? "Withdraw the active snapshot (guided: reactivate another first)"
                : ACTIONS[e.action as ManualAction].label
              : status === "blocked"
                ? `${ACTIONS[e.action as ManualAction].label} — ${a?.reason ?? "not available"}`
                : e.system
                  ? "Happens automatically when another snapshot is approved"
                  : undefined;
          const at = e.lat === "start" ? g.p1 : e.lat === "end" ? g.p2 : g.mid;
          const lx = at.x + (e.ld?.[0] ?? 0);
          const ly = at.y + (e.ld?.[1] ?? 0);
          const run = () => clickable && action && onAction?.(action);
          return (
            <g
              key={e.id}
              data-edge={e.id}
              data-status={status}
              role={clickable ? "button" : undefined}
              tabIndex={clickable ? 0 : undefined}
              aria-label={clickable ? title : undefined}
              onClick={clickable ? run : undefined}
              onKeyDown={
                clickable
                  ? (ev) => {
                      if (ev.key === "Enter" || ev.key === " ") {
                        ev.preventDefault();
                        run();
                      }
                    }
                  : undefined
              }
              className={cn("group/edge outline-none", clickable && "cursor-pointer")}
              style={{ opacity: status === "idle" ? (compact ? 0.45 : 0.62) : 1, transition: "opacity .4s" }}
            >
              {title && <title>{title}</title>}
              {clickable && <path d={g.path} fill="none" stroke="transparent" strokeWidth={compact ? 12 : 18} />}
              <path
                d={g.path}
                fill="none"
                style={{
                  stroke: edgeStroke(status),
                  strokeWidth: status === "travelled" ? (compact ? 1.8 : 2.4) : status === "available" ? (compact ? 1.8 : 2.2) : compact ? 1 : 1.3,
                  transition: "stroke .4s, stroke-width .4s",
                }}
                strokeDasharray={e.dashed || status === "blocked" ? "4 4" : status === "available" ? "6 5" : undefined}
                strokeLinecap="round"
                markerEnd={`url(#${uid}-arrow-${status})`}
                className={cn(status === "available" && !reduce && "animate-[mos-lifecycle-dash_1.1s_linear_infinite]")}
              />
              {status === "travelled" && (
                <motion.path
                  d={g.path}
                  fill="none"
                  style={{ stroke: "var(--tone-info)", strokeWidth: compact ? 1.8 : 2.4, opacity: 0.0 }}
                  initial={reduce ? false : { pathLength: 0, opacity: 0.9 }}
                  animate={{ pathLength: 1, opacity: 0 }}
                  transition={{ duration: 0.9, delay: reduce ? 0 : i * 0.04, ease: "easeOut" }}
                />
              )}
              {!compact && e.label && (
                <g transform={`translate(${lx} ${ly})`}>
                  {status === "available" && (
                    <rect
                      x={e.anchor === "end" ? -(e.label.length * 5.3 + 14) : e.anchor === "start" ? -5 : -(e.label.length * 2.65 + 7)}
                      y={-9.5}
                      width={e.label.length * 5.3 + 12}
                      height={19}
                      rx={9.5}
                      style={{ fill: mixTone("info", 16, "var(--card)"), stroke: "var(--primary)", strokeWidth: 1 }}
                      className="group-hover/edge:fill-primary/25 group-focus-visible/edge:stroke-2"
                    />
                  )}
                  <text
                    textAnchor={e.anchor ?? "middle"}
                    dominantBaseline="central"
                    style={{
                      fontSize: 10.5,
                      fill: status === "available" ? "var(--primary)" : status === "travelled" ? "var(--foreground)" : "var(--muted-foreground)",
                      fontWeight: status === "available" || status === "travelled" ? 600 : 400,
                    }}
                    dx={status === "available" ? (e.anchor === "end" ? -7 : e.anchor === "start" ? 1 : 0) : 0}
                  >
                    {e.label}
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {/* nodes */}
        {NODE_ORDER.map((s) => {
          const m = STATE_META[s];
          const b = nodeBox(d, s);
          const isCurrent = s === state;
          const isVisited = visited.has(s);
          return (
            <g
              key={s}
              data-state={s}
              data-current={isCurrent || undefined}
              style={{ opacity: isCurrent || isVisited ? 1 : compact ? 0.5 : 0.7, transition: "opacity .4s", filter: isCurrent ? `drop-shadow(0 0 ${compact ? 5 : 11}px ${mixTone(m.tone, 55, "transparent")})` : undefined }}
            >
              <title>{`${m.code} · ${m.label} — ${m.description}`}</title>
              <rect
                x={b.x}
                y={b.y}
                width={b.w}
                height={b.h}
                rx={compact ? 8 : 13}
                style={{
                  fill: isCurrent ? mixTone(m.tone, 17) : isVisited ? mixTone(m.tone, 6) : "var(--card)",
                  stroke: isCurrent ? toneVar(m.tone) : isVisited ? mixTone(m.tone, 55, "var(--border)") : "var(--border)",
                  strokeWidth: isCurrent ? 1.75 : 1,
                  transition: "fill .5s, stroke .5s, stroke-width .3s",
                }}
              />
              {isCurrent && !reduce && (
                <motion.rect
                  x={b.x - 4}
                  y={b.y - 4}
                  width={b.w + 8}
                  height={b.h + 8}
                  rx={compact ? 11 : 17}
                  fill="none"
                  style={{ stroke: toneVar(m.tone), strokeWidth: 1.2 }}
                  animate={{ opacity: [0.0, 0.55, 0.0] }}
                  transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
                />
              )}
              {compact ? (
                <text
                  x={b.cx}
                  y={b.cy}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="font-mono"
                  style={{ fontSize: 11, fontWeight: 600, fill: isCurrent || isVisited ? toneVar(m.tone) : "var(--muted-foreground)" }}
                >
                  {m.code}
                </text>
              ) : (
                <>
                  <text x={b.x + 11} y={b.y + 16} className="font-mono" style={{ fontSize: 10, fill: isCurrent || isVisited ? toneVar(m.tone) : "var(--muted-foreground)", opacity: 0.9 }}>
                    {m.code}
                  </text>
                  {m.env && (
                    <text x={b.x + b.w - 10} y={b.y + 16} textAnchor="end" className="font-mono" style={{ fontSize: 8.5, letterSpacing: 0.8, fill: "var(--muted-foreground)" }}>
                      {m.env}
                    </text>
                  )}
                  <text
                    x={b.cx}
                    y={b.y + 36}
                    textAnchor="middle"
                    style={{ fontSize: 12.5, fontWeight: isCurrent ? 650 : 500, fill: isCurrent ? toneVar(m.tone) : "var(--foreground)" }}
                  >
                    {m.short}
                  </text>
                </>
              )}
            </g>
          );
        })}

        {/* you-are-here token: glides between states */}
        <motion.g
          initial={false}
          animate={{ x: cur.x + cur.w - (compact ? 4 : 10), y: cur.y - (compact ? 1 : 0) }}
          transition={spring}
          aria-hidden
        >
          <circle r={compact ? 3.2 : 5} style={{ fill: toneVar(meta.tone), stroke: "var(--card)", strokeWidth: 2, transition: "fill .4s" }} />
          {!reduce && (
            <motion.circle
              r={compact ? 3.2 : 5}
              fill="none"
              style={{ stroke: toneVar(meta.tone), strokeWidth: 1.5 }}
              animate={{ r: [compact ? 3.2 : 5, compact ? 8 : 13], opacity: [0.7, 0] }}
              transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
            />
          )}
        </motion.g>
      </svg>

      {showLegend && (
        <figcaption className="mt-1 flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] text-muted-foreground">
          <LegendItem swatch={<span className="size-2 rounded-full" style={{ background: toneVar(meta.tone) }} />}>You are here</LegendItem>
          <LegendItem swatch={<span className="h-0.5 w-5 rounded" style={{ background: "var(--foreground)" }} />}>Path this snapshot travelled</LegendItem>
          <LegendItem swatch={<span className="h-0.5 w-5 rounded" style={{ background: "repeating-linear-gradient(90deg, var(--primary) 0 5px, transparent 5px 9px)" }} />}>
            You can do this now{onAction ? " — click" : ""}
          </LegendItem>
          <LegendItem swatch={<span className="h-px w-5" style={{ background: "var(--muted-foreground)", opacity: 0.6 }} />}>Other moves</LegendItem>
        </figcaption>
      )}
    </figure>
  );
}

function LegendItem({ swatch, children }: { swatch: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {swatch}
      {children}
    </span>
  );
}

function rank(s: string): number {
  return s === "idle" ? 0 : s === "blocked" ? 1 : s === "travelled" ? 2 : 3;
}

function edgeStroke(status: "idle" | "travelled" | "available" | "blocked"): string {
  switch (status) {
    case "travelled":
      return "color-mix(in oklch, var(--tone-info) 80%, var(--foreground))";
    case "available":
      return "var(--primary)";
    case "blocked":
      return "var(--muted-foreground)";
    default:
      return "color-mix(in oklch, var(--muted-foreground) 70%, transparent)";
  }
}
