"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowUpRight, Bug, CheckCircle2, Clock, Flag, HelpCircle, Info, Radio, Terminal, XCircle, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { RunRow } from "@/lib/data/types";

/** One entry of a run's event log, shaped like the run-worker protocol (see CONTRACTS.md). */
export interface RunEvent {
  type: string;
  t?: number;
  [key: string]: unknown;
}

export type RunDetail = Pick<RunRow, "id" | "args" | "options" | "outcome" | "error" | "events" | "summary">;

type Filter = "all" | "command" | "tm" | "log" | "prompt";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "command", label: "Commands" },
  { key: "tm", label: "Telemetry" },
  { key: "log", label: "Logs" },
  { key: "prompt", label: "Prompts" },
];
const MAX_ROWS = 400;

function fmtT(t: unknown): string {
  return typeof t === "number" && Number.isFinite(t) ? `+${t < 100 ? t.toFixed(1) : Math.round(t)}s` : "";
}

function short(v: unknown, max = 110): string {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  if (s === undefined) return "";
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function fmtArgs(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  return Object.entries(args as Record<string, unknown>)
    .map(([k, v]) => `${k}=${short(v, 40)}`)
    .join(", ");
}

const matches = (e: RunEvent, f: Filter) => (f === "all" ? e.type !== "telemetry" : e.type === f || (f === "log" && e.type === "stdout"));

/** Console-style timeline of a run: virtual time, an icon per event kind, and the payload. */
export function RunLog({ events }: { events: RunEvent[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [all, setAll] = useState(false);
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, command: 0, tm: 0, log: 0, prompt: 0 };
    for (const e of events) {
      if (e.type === "telemetry") continue;
      c.all++;
      if (e.type === "command") c.command++;
      else if (e.type === "tm") c.tm++;
      else if (e.type === "log" || e.type === "stdout") c.log++;
      else if (e.type === "prompt") c.prompt++;
    }
    return c;
  }, [events]);
  const rows = useMemo(() => events.filter((e) => matches(e, filter)), [events, filter]);
  const shown = all ? rows : rows.slice(0, MAX_ROWS);

  if (events.length === 0) return <p className="px-4 py-6 text-center text-[13px] text-muted-foreground">This run recorded no events.</p>;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 border-b px-3 py-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
            className={cn(
              "inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60",
              filter === f.key ? "border-primary/40 bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted",
            )}
          >
            {f.label} <span className="tabular opacity-70">{counts[f.key]}</span>
          </button>
        ))}
      </div>
      <ol className="max-h-[28rem] overflow-y-auto bg-background/40 py-1 font-mono text-[12px] leading-relaxed" aria-label="Run event log">
        {shown.map((e, i) => (
          <EventRow key={i} e={e} />
        ))}
        {!all && rows.length > MAX_ROWS && (
          <li className="px-3 py-2">
            <Button variant="outline" size="xs" onClick={() => setAll(true)}>
              Show all {rows.length} events
            </Button>
          </li>
        )}
      </ol>
    </div>
  );
}

function Row({ t, icon: Icon, tone, children }: { t?: number; icon: LucideIcon; tone?: string; children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[3.75rem_1rem_minmax(0,1fr)] items-start gap-2 px-3 py-0.5 hover:bg-muted/40">
      <span className="text-right text-[11px] text-muted-foreground tabular">{fmtT(t)}</span>
      <Icon className={cn("mt-[3px] size-3.5", tone ?? "text-muted-foreground")} />
      <div className="min-w-0 break-words whitespace-pre-wrap">{children}</div>
    </li>
  );
}

function EventRow({ e }: { e: RunEvent }) {
  switch (e.type) {
    case "log": {
      const level = String(e.level ?? "info");
      const Icon = level === "error" ? XCircle : level === "warning" ? AlertTriangle : level === "debug" ? Bug : Info;
      const tone = level === "error" ? "text-tone-danger" : level === "warning" ? "text-tone-warn" : level === "debug" ? "text-muted-foreground" : "text-tone-info";
      return (
        <Row t={e.t} icon={Icon} tone={tone}>
          <span className={cn(level === "error" && "text-tone-danger", level === "warning" && "text-tone-warn", level === "debug" && "text-muted-foreground")}>{String(e.msg ?? "")}</span>
        </Row>
      );
    }
    case "stdout":
      return (
        <Row t={e.t} icon={Terminal}>
          <span className="text-muted-foreground">{String(e.text ?? "").replace(/\n$/, "")}</span>
        </Row>
      );
    case "command": {
      const status = String(e.status ?? "issued");
      const Icon = status === "completed" ? CheckCircle2 : status === "failed" ? XCircle : status === "timeout" ? Clock : ArrowUpRight;
      const tone = status === "completed" ? "text-tone-success" : status === "failed" ? "text-tone-danger" : status === "timeout" ? "text-tone-warn" : "text-tone-info";
      const args = fmtArgs(e.args);
      return (
        <Row t={e.t} icon={Icon} tone={tone}>
          <span className="font-semibold">{String(e.cls ?? e.q ?? "command")}</span>
          {args && <span className="text-muted-foreground">({args})</span>}
          <span className={cn("ml-2 rounded px-1.5 py-px text-[10px] uppercase tracking-wide", status === "failed" ? "bg-tone-danger/10 text-tone-danger" : status === "timeout" ? "bg-tone-warn/10 text-tone-warn" : status === "completed" ? "bg-tone-success/10 text-tone-success" : "bg-muted text-muted-foreground")}>
            {status}
          </span>
          {typeof e.q === "string" && <span className="ml-2 text-[11px] text-muted-foreground">{e.q}</span>}
        </Row>
      );
    }
    case "tm":
      return (
        <Row t={e.t} icon={Radio} tone="text-tone-progress">
          <span className="text-muted-foreground">{String(e.cls ?? e.q ?? "")}</span> <span className="text-muted-foreground">=</span> <span className="font-semibold">{short(e.value, 80)}</span>
          {e.fresh === false && <span className="ml-2 rounded bg-tone-warn/10 px-1.5 py-px text-[10px] uppercase tracking-wide text-tone-warn">stale</span>}
        </Row>
      );
    case "prompt":
      return (
        <Row t={e.t} icon={HelpCircle} tone="text-tone-warn">
          <span className="font-semibold">{String(e.message ?? "")}</span>
          {Array.isArray(e.choices) && e.choices.length > 0 && (
            <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
              {(e.choices as unknown[]).map((c, i) => (
                <span key={i} className="rounded border px-1.5 py-px text-[10px] text-muted-foreground">
                  {String(c)}
                </span>
              ))}
            </span>
          )}
        </Row>
      );
    case "done": {
      const outcome = String(e.outcome ?? "");
      const bad = outcome === "error";
      return (
        <Row t={e.t} icon={Flag} tone={bad ? "text-tone-danger" : "text-tone-success"}>
          <span className={cn("font-semibold", bad ? "text-tone-danger" : "text-tone-success")}>Run {outcome}</span>
          {typeof e.virtualSeconds === "number" && <span className="text-muted-foreground"> · {e.virtualSeconds.toFixed(1)} s virtual</span>}
          {typeof e.wallMs === "number" && <span className="text-muted-foreground"> · {Math.round(e.wallMs)} ms wall</span>}
          {typeof e.error === "string" && e.error && <span className="block text-tone-danger">{e.error}</span>}
          {typeof e.traceback === "string" && e.traceback && <span className="mt-1 block text-[11px] text-muted-foreground">{e.traceback}</span>}
        </Row>
      );
    }
    default:
      return (
        <Row t={e.t} icon={Info}>
          <span className="text-muted-foreground">{e.type}: {short(e, 160)}</span>
        </Row>
      );
  }
}

/** Fetches a run's full record (including events) the first time it is opened. */
export function useRunDetail(runId: string, enabled: boolean) {
  const [state, setState] = useState<{ status: "idle" | "loading" | "ready" | "error"; run?: RunDetail; error?: string }>({ status: "idle" });
  const started = useRef(false);
  useEffect(() => {
    if (!enabled || started.current) return;
    started.current = true;
    setState({ status: "loading" });
    fetch(`/api/runs/${runId}`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body?.error ?? `HTTP ${r.status}`);
        return body as RunDetail;
      })
      .then((run) => setState({ status: "ready", run }))
      .catch((e: unknown) => {
        started.current = false;
        setState({ status: "error", error: e instanceof Error ? e.message : String(e) });
      });
  }, [enabled, runId]);
  return state;
}

export function RunLogSkeleton() {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-3.5" style={{ width: `${40 + ((i * 29) % 50)}%` }} />
      ))}
    </div>
  );
}
