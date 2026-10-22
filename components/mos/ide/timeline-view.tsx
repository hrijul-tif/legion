"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Activity } from "lucide-react";
import {
  buildTimeline,
  formatVirtual,
  type TimelineBar,
} from "@/lib/ide/console-model";
import { useRunSession } from "./run-session";

const GUTTER = 84;
const PAD_R = 16;
const SUB_H = 13;

const STATUS_FILL: Record<TimelineBar["status"], string> = {
  pending: "fill-tone-info/60",
  issued: "fill-tone-info/60",
  completed: "fill-tone-success",
  failed: "fill-tone-danger",
  timeout: "fill-tone-warn",
};
const LEVEL_STROKE = {
  debug: "stroke-muted-foreground/40",
  info: "stroke-tone-info/70",
  warning: "stroke-tone-warn",
  error: "stroke-tone-danger",
} as const;

function pack(bars: TimelineBar[]): { bar: TimelineBar; row: number }[] {
  const ends: number[] = [];
  return bars.map((bar) => {
    let row = ends.findIndex((e) => e <= bar.start);
    if (row < 0) row = ends.length;
    ends[row] = Math.max(bar.end, bar.start + 0.0001);
    return { bar, row };
  });
}

function niceStep(duration: number, width: number): number {
  const target = Math.max(2, Math.floor(width / 110));
  const raw = duration / target;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

export function TimelineView() {
  const { run } = useRunSession();
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [tip, setTip] = useState<{
    x: number;
    y: number;
    text: string;
    t: number;
  } | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() =>
      setWidth(Math.max(320, el.clientWidth)),
    );
    ro.observe(el);
    setWidth(Math.max(320, el.clientWidth));
    return () => ro.disconnect();
  }, []);

  const model = useMemo(
    () => buildTimeline(run.events, run.outcome),
    [run.events, run.outcome],
  );
  const bars = useMemo(() => pack(model.commands), [model.commands]);
  const cmdRows = Math.max(1, ...bars.map((b) => b.row + 1));

  if (
    !model.commands.length &&
    !model.tm.length &&
    !model.logs.length &&
    !model.prompts.length
  ) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <span className="flex size-10 items-center justify-center rounded-full border bg-muted/50 text-muted-foreground">
          <Activity className="size-4.5" />
        </span>
        <p className="text-sm font-medium">
          The timeline fills in as the procedure runs
        </p>
        <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
          Commands, telemetry reads, prompts and log lines are laid out over
          spacecraft time.
        </p>
      </div>
    );
  }

  const plotW = width - GUTTER - PAD_R;
  const x = (t: number) =>
    GUTTER + (Math.min(t, model.duration) / model.duration) * plotW;
  const lanes = [
    { key: "cmd", label: "Commands", h: cmdRows * SUB_H + 12 },
    { key: "tm", label: "TM reads", h: 26 },
    { key: "prompt", label: "Prompts", h: 26 },
    { key: "log", label: "Logs", h: 26 },
  ];
  const tops: number[] = [];
  let acc = 22;
  for (const l of lanes) {
    tops.push(acc);
    acc += l.h;
  }
  const totalH = acc + 8;
  const step = niceStep(model.duration, plotW);
  const ticks: number[] = [];
  for (let t = 0; t <= model.duration + 1e-9; t += step) ticks.push(t);

  const show = (e: React.MouseEvent, text: string, t: number) => {
    const box = wrap.current?.getBoundingClientRect();
    if (box)
      setTip({ x: e.clientX - box.left, y: e.clientY - box.top, text, t });
  };

  return (
    <div
      ref={wrap}
      className="ide-scroll relative h-full overflow-auto"
      onMouseLeave={() => setTip(null)}
    >
      <svg
        width={width}
        height={totalH}
        role="img"
        aria-label="Run timeline"
        className="block select-none"
      >
        {/* grid + axis */}
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={x(t)}
              x2={x(t)}
              y1={16}
              y2={totalH - 4}
              className="stroke-border"
              strokeDasharray="2 4"
            />
            <text
              x={x(t)}
              y={11}
              textAnchor="middle"
              className="fill-muted-foreground font-mono text-[10px]"
            >
              {formatVirtual(t).replace("T+", "")}
            </text>
          </g>
        ))}
        {lanes.map((l, i) => (
          <g key={l.key}>
            <rect
              x={0}
              y={tops[i]}
              width={width}
              height={l.h}
              className={i % 2 ? "fill-transparent" : "fill-muted/30"}
            />
            <text
              x={10}
              y={tops[i] + l.h / 2 + 3}
              className="fill-muted-foreground text-[10px] font-medium"
            >
              {l.label}
            </text>
          </g>
        ))}

        {/* commands */}
        {bars.map(({ bar, row }) => {
          const x1 = x(bar.start);
          const w = Math.max(3, x(bar.end) - x1);
          return (
            <rect
              key={bar.key}
              x={x1}
              y={tops[0] + 6 + row * SUB_H}
              width={w}
              height={SUB_H - 3}
              rx={2}
              className={STATUS_FILL[bar.status]}
              onMouseMove={(e) =>
                show(
                  e,
                  `${bar.label} · ${bar.status}${bar.end > bar.start ? ` · ${(bar.end - bar.start).toFixed(1)}s` : ""}`,
                  bar.start,
                )
              }
            />
          );
        })}

        {/* telemetry */}
        {model.tm.map((d) => (
          <circle
            key={d.key}
            cx={x(d.t)}
            cy={tops[1] + lanes[1].h / 2}
            r={3.5}
            className={d.ok ? "fill-tone-progress" : "fill-tone-danger"}
            onMouseMove={(e) => show(e, d.label, d.t)}
          />
        ))}

        {/* prompts */}
        {model.prompts.map((p) => (
          <g key={p.key} onMouseMove={(e) => show(e, p.label, p.t)}>
            <line
              x1={x(p.t)}
              x2={x(p.t)}
              y1={tops[2] + 4}
              y2={tops[2] + lanes[2].h - 4}
              className="stroke-tone-warn"
              strokeWidth={1.5}
            />
            <path
              d={`M${x(p.t)} ${tops[2] + 4} l9 4 l-9 4 z`}
              className="fill-tone-warn"
            />
          </g>
        ))}

        {/* logs */}
        {model.logs.map((l) => (
          <line
            key={l.key}
            x1={x(l.t)}
            x2={x(l.t)}
            y1={tops[3] + 6}
            y2={tops[3] + lanes[3].h - 6}
            strokeWidth={l.level === "error" || l.level === "warning" ? 2 : 1}
            className={LEVEL_STROKE[l.level]}
            onMouseMove={(e) => show(e, l.label, l.t)}
          />
        ))}
      </svg>
      {tip && (
        <div
          className="pointer-events-none absolute z-10 max-w-xs rounded-md border bg-popover px-2 py-1 text-[11px] shadow-md"
          style={{
            left: Math.min(tip.x + 12, Math.max(0, width - 260)),
            top: tip.y + 14,
          }}
        >
          <span className="mr-1.5 font-mono text-muted-foreground">
            {formatVirtual(tip.t)}
          </span>
          <span className="break-words">
            {tip.text.length > 160 ? `${tip.text.slice(0, 160)}…` : tip.text}
          </span>
        </div>
      )}
    </div>
  );
}
