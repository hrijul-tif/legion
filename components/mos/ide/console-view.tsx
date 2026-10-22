"use client";

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowDown,
  Bug,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Eraser,
  Info,
  OctagonX,
  Search,
  Terminal,
  TriangleAlert,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  buildRows,
  errorLine,
  filterRows,
  formatValue,
  formatVirtual,
  levelCounts,
  MAX_ROWS,
  parseTraceback,
  type CommandRow,
  type ConsoleFilter,
  type ConsoleRow,
} from "@/lib/ide/console-model";
import type { LogEvent } from "@/lib/sandbox/types";
import { useRunSession } from "./run-session";

const LEVEL_META: Record<
  LogEvent["level"],
  { icon: typeof Info; tone: string; label: string }
> = {
  debug: { icon: Bug, tone: "text-muted-foreground", label: "Debug" },
  info: { icon: Info, tone: "text-tone-info", label: "Info" },
  warning: { icon: TriangleAlert, tone: "text-tone-warn", label: "Warn" },
  error: { icon: OctagonX, tone: "text-tone-danger", label: "Error" },
};

const STATUS_STYLE: Record<string, string> = {
  issued: "border-tone-info/30 bg-tone-info/10 text-tone-info",
  completed: "border-tone-success/30 bg-tone-success/10 text-tone-success",
  failed: "border-tone-danger/30 bg-tone-danger/10 text-tone-danger",
  timeout: "border-tone-warn/30 bg-tone-warn/10 text-tone-warn",
};

const TimeCell = ({ t }: { t: number }) => (
  <span className="tabular pt-px text-right font-mono text-[11px] text-muted-foreground select-none">
    {formatVirtual(t)}
  </span>
);

function argsPreview(
  args: Record<string, unknown>,
): { k: string; v: string }[] {
  return Object.entries(args).map(([k, v]) => ({ k, v: formatValue(v) }));
}

const CommandCard = memo(function CommandCard({ row }: { row: CommandRow }) {
  const final = row.final;
  const status = final?.status ?? "issued";
  const args = argsPreview(row.issued.args);
  const took = final ? Math.max(0, final.t - row.issued.t) : null;
  return (
    <div
      className={cn(
        "min-w-0 rounded-md border bg-card/60 px-2 py-1",
        status === "failed" && "border-tone-danger/30",
        status === "timeout" && "border-tone-warn/30",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className="truncate font-mono text-xs font-semibold"
          title={row.issued.q}
        >
          {row.issued.cls || row.issued.q}
        </span>
        <span className="hidden truncate font-mono text-[10px] text-muted-foreground sm:inline">
          {row.issued.q}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {took !== null && took > 0 && (
            <span className="tabular font-mono text-[10px] text-muted-foreground">
              +{took.toFixed(1)}s
            </span>
          )}
          <span
            className={cn(
              "rounded-full border px-1.5 py-px text-[10px] font-medium",
              STATUS_STYLE[status],
            )}
          >
            {status}
          </span>
        </span>
      </div>
      {args.length > 0 && (
        <div className="mt-0.5 flex flex-wrap gap-x-2.5 gap-y-0.5">
          {args.map((a) => (
            <span
              key={a.k}
              className="max-w-full truncate font-mono text-[11px] text-muted-foreground"
              title={`${a.k}=${a.v}`}
            >
              <span>{a.k}</span>
              <span className="opacity-60">=</span>
              <span className="text-foreground/85">{a.v}</span>
            </span>
          ))}
        </div>
      )}
      {final?.error && (
        <p className="mt-0.5 text-[11px] text-tone-danger">{final.error}</p>
      )}
    </div>
  );
});

function Traceback({
  text,
  onRevealLine,
}: {
  text: string;
  onRevealLine?(line: number): void;
}) {
  const [open, setOpen] = useState(false);
  const lines = parseTraceback(text);
  const first = errorLine(text);
  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
      >
        <ChevronRight
          className={cn("size-3 transition-transform", open && "rotate-90")}
        />{" "}
        Traceback{first ? ` · line ${first}` : ""}
      </button>
      {open && (
        <pre className="mt-1 overflow-x-auto rounded border bg-background/60 p-1.5 font-mono text-[11px] leading-relaxed">
          {lines.map((l, i) =>
            l.line && onRevealLine ? (
              <button
                key={i}
                type="button"
                onClick={() => onRevealLine(l.line!)}
                className="block w-full text-left text-primary hover:underline"
              >
                {l.text}
              </button>
            ) : (
              <span key={i} className="block">
                {l.text || " "}
              </span>
            ),
          )}
        </pre>
      )}
    </div>
  );
}

const RowView = memo(function RowView({
  row,
  answer,
  onRevealLine,
}: {
  row: ConsoleRow;
  answer?: string;
  onRevealLine?(line: number): void;
}) {
  const base =
    "ide-row-in grid grid-cols-[4.6rem_1rem_minmax(0,1fr)_auto] items-start gap-x-2 px-3 py-[3px] hover:bg-muted/40";
  switch (row.kind) {
    case "log": {
      const meta = LEVEL_META[row.ev.level];
      const Icon = meta.icon;
      // an exception logged with a traceback: the message carries it after the first line
      const head = row.ev.msg.split("\n")[0];
      const tracebackText = /^Traceback \(most recent call last\)/m.test(
        row.ev.msg,
      )
        ? row.ev.msg.slice(row.ev.msg.indexOf("Traceback"))
        : null;
      return (
        <div
          className={cn(
            base,
            row.ev.level === "error" && "bg-tone-danger/[0.05]",
            row.ev.level === "warning" && "bg-tone-warn/[0.04]",
          )}
        >
          <TimeCell t={row.ev.t} />
          <Icon
            className={cn("mt-0.5 size-3.5", meta.tone)}
            aria-label={meta.label}
          />
          <div className="min-w-0">
            <p
              className={cn(
                "font-mono text-xs leading-snug break-words whitespace-pre-wrap",
                row.ev.level === "debug" && "text-muted-foreground",
              )}
            >
              {tracebackText ? head : row.ev.msg}
            </p>
            {tracebackText && (
              <Traceback text={tracebackText} onRevealLine={onRevealLine} />
            )}
          </div>
          {row.ev.logger && row.ev.logger !== "run" ? (
            <span className="rounded border px-1 font-mono text-[10px] text-muted-foreground">
              {row.ev.logger}
            </span>
          ) : (
            <span />
          )}
        </div>
      );
    }
    case "stdout":
      return (
        <div className={base}>
          <TimeCell t={row.ev.t} />
          <Terminal
            className={cn(
              "mt-0.5 size-3.5",
              row.ev.stream === "stderr"
                ? "text-tone-warn"
                : "text-muted-foreground",
            )}
            aria-label="Output"
          />
          <p
            className={cn(
              "font-mono text-xs leading-snug break-words whitespace-pre-wrap",
              row.ev.stream === "stderr" && "text-tone-warn",
            )}
          >
            {row.ev.text || " "}
          </p>
          <span className="rounded border px-1 font-mono text-[10px] text-muted-foreground">
            {row.ev.stream ?? "print"}
          </span>
        </div>
      );
    case "command":
      return (
        <div className={base}>
          <TimeCell t={row.issued.t} />
          <ChevronRight
            className="mt-1 size-3.5 text-primary"
            aria-label="Command"
          />
          <CommandCard row={row} />
          <span />
        </div>
      );
    case "tm": {
      const missing = row.ev.value === null || row.ev.value === undefined;
      return (
        <div className={base}>
          <TimeCell t={row.ev.t} />
          <span
            className="mt-1 size-2 justify-self-center rounded-full bg-tone-progress"
            aria-label="Telemetry read"
          />
          <p className="min-w-0 font-mono text-xs leading-snug break-words">
            <span className="text-muted-foreground" title={row.ev.q}>
              {row.ev.cls ?? row.ev.q}
            </span>
            <span className="px-1.5 opacity-50">=</span>
            <span
              className={cn("font-semibold", missing && "text-tone-danger")}
            >
              {formatValue(row.ev.value)}
            </span>
          </p>
          <span
            className={cn(
              "rounded border px-1 text-[10px]",
              row.ev.fresh
                ? "border-tone-success/30 text-tone-success"
                : "text-muted-foreground",
            )}
            title={
              row.ev.fresh
                ? "Waited for a new sample"
                : "Latest cached value (may be stale)"
            }
          >
            {row.ev.fresh ? "fresh" : "latest"}
          </span>
        </div>
      );
    }
    case "prompt":
      return (
        <div className={cn(base, "bg-tone-warn/[0.06]")}>
          <TimeCell t={row.ev.t} />
          <CircleAlert
            className="mt-0.5 size-3.5 text-tone-warn"
            aria-label="Operator prompt"
          />
          <div className="min-w-0">
            <p className="font-mono text-xs leading-snug font-medium break-words whitespace-pre-wrap">
              {row.ev.message}
            </p>
            <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
              {answer ? (
                <>
                  <CheckCircle2 className="size-3 text-tone-success" /> You
                  chose{" "}
                  <span className="font-mono text-foreground">{answer}</span>
                </>
              ) : (
                <>Options: {row.ev.choices.join(" · ")}</>
              )}
            </p>
          </div>
          <span className="rounded border border-tone-warn/30 px-1 text-[10px] text-tone-warn">
            prompt
          </span>
        </div>
      );
    case "done":
      return (
        <div className={cn(base, "border-t")}>
          <TimeCell t={row.ev.t} />
          <CheckCircle2
            className={cn(
              "mt-0.5 size-3.5",
              row.ev.outcome === "completed"
                ? "text-tone-success"
                : row.ev.outcome === "error"
                  ? "text-tone-danger"
                  : "text-tone-warn",
            )}
          />
          <p className="font-mono text-xs font-medium">
            Run {row.ev.outcome}
            {row.ev.error && (
              <span className="font-normal text-muted-foreground">
                {" "}
                — {row.ev.error}
              </span>
            )}
          </p>
          <span />
        </div>
      );
  }
});

function Chip({
  on,
  onClick,
  children,
  tone,
}: {
  on: boolean;
  onClick(): void;
  children: React.ReactNode;
  tone?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-md border px-1.5 text-[11px] font-medium transition-colors",
        on
          ? "border-border bg-muted text-foreground"
          : "border-transparent text-muted-foreground/70 hover:text-foreground",
        on && tone,
      )}
    >
      {children}
    </button>
  );
}

export interface ConsoleViewProps {
  filter: ConsoleFilter;
  onFilter(f: ConsoleFilter): void;
  onRevealLine?(line: number): void;
}

export function ConsoleToolbar({
  filter,
  onFilter,
  rows,
}: {
  filter: ConsoleFilter;
  onFilter(f: ConsoleFilter): void;
  rows: ConsoleRow[];
}) {
  const { run } = useRunSession();
  const counts = useMemo(() => levelCounts(rows), [rows]);
  const toggleLevel = (l: LogEvent["level"]) => {
    const next = new Set(filter.levels);
    if (next.has(l)) next.delete(l);
    else next.add(l);
    onFilter({ ...filter, levels: next });
  };
  return (
    <div className="flex items-center gap-1">
      {(Object.keys(LEVEL_META) as LogEvent["level"][]).map((l) => (
        <Chip
          key={l}
          on={filter.levels.has(l)}
          onClick={() => toggleLevel(l)}
          tone={LEVEL_META[l].tone}
        >
          {LEVEL_META[l].label}
          <span className="tabular opacity-70">{counts[l]}</span>
        </Chip>
      ))}
      <span className="mx-0.5 h-4 w-px bg-border" />
      <Chip
        on={filter.showCommands}
        onClick={() =>
          onFilter({ ...filter, showCommands: !filter.showCommands })
        }
      >
        Commands
      </Chip>
      <Chip
        on={filter.showTm}
        onClick={() => onFilter({ ...filter, showTm: !filter.showTm })}
      >
        TM
      </Chip>
      <Chip
        on={filter.showOutput}
        onClick={() => onFilter({ ...filter, showOutput: !filter.showOutput })}
      >
        Output
      </Chip>
      <div className="relative ml-1">
        <Search className="pointer-events-none absolute top-1/2 left-1.5 size-3 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={filter.text}
          onChange={(e) => onFilter({ ...filter, text: e.target.value })}
          placeholder="Filter"
          aria-label="Filter console"
          className="h-6 w-32 rounded-md pr-5 pl-5 text-[11px] md:text-[11px]"
        />
        {filter.text && (
          <button
            type="button"
            aria-label="Clear filter"
            onClick={() => onFilter({ ...filter, text: "" })}
            className="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        )}
      </div>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="More console options"
            className="text-muted-foreground"
          >
            <Bug />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 gap-2">
          <label className="flex items-center justify-between gap-3 text-xs">
            <span>
              Show <span className="font-mono">csv</span> logger
              <span className="block text-[11px] text-muted-foreground">
                Repeats the run log messages in CSV form
              </span>
            </span>
            <Switch
              size="sm"
              checked={filter.showCsv}
              onCheckedChange={(c) => onFilter({ ...filter, showCsv: c })}
            />
          </label>
        </PopoverContent>
      </Popover>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Clear console"
        title="Clear console"
        disabled={
          run.status === "running" ||
          run.status === "booting" ||
          run.status === "prompt"
        }
        onClick={() => run.reset()}
        className="text-muted-foreground"
      >
        <Eraser />
      </Button>
    </div>
  );
}

export function useConsoleRows(filter: ConsoleFilter) {
  const { run } = useRunSession();
  const all = useMemo(() => buildRows(run.events), [run.events]);
  const rows = useMemo(() => filterRows(all, filter), [all, filter]);
  return { all, rows };
}

export function ConsoleView({
  rows,
  onRevealLine,
}: {
  rows: ConsoleRow[];
  onRevealLine?(line: number): void;
}) {
  const { run, answers } = useRunSession();
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [stuck, setStuck] = useState(true);

  const hidden = Math.max(0, rows.length - MAX_ROWS);
  const visible = hidden ? rows.slice(hidden) : rows;

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [visible.length, run.prompt]);

  const empty = run.events.length === 0;
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [empty]);

  const lastClient = useRef(0);
  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    // the panel was resized (prompt banner opened/closed): keep following the log instead of treating it as a user scroll
    if (
      lastClient.current &&
      el.clientHeight !== lastClient.current &&
      stick.current
    ) {
      lastClient.current = el.clientHeight;
      el.scrollTop = el.scrollHeight;
      return;
    }
    lastClient.current = el.clientHeight;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 28;
    stick.current = atBottom;
    setStuck((s) => (s === atBottom ? s : atBottom));
  }, []);

  const jump = () => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    stick.current = true;
    setStuck(true);
  };

  if (run.events.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <span className="flex size-10 items-center justify-center rounded-full border bg-muted/50 text-muted-foreground">
          <Terminal className="size-4.5" />
        </span>
        <p className="text-sm font-medium">Nothing has run yet</p>
        <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
          Run the procedure against the mock spacecraft to see commands and
          telemetry here. Prompts the procedure raises will appear above this
          log.
        </p>
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-0">
      <div
        ref={scroller}
        onScroll={onScroll}
        className="ide-scroll h-full overflow-y-auto py-1"
        role="log"
        aria-live="off"
        aria-label="Run console"
      >
        {hidden > 0 && (
          <p className="px-3 py-1 text-center text-[11px] text-muted-foreground">
            {hidden.toLocaleString()} earlier rows hidden
          </p>
        )}
        {visible.map((row) => (
          <RowView
            key={row.key}
            row={row}
            answer={row.kind === "prompt" ? answers[row.ev.id] : undefined}
            onRevealLine={onRevealLine}
          />
        ))}
      </div>
      {!stuck && (
        <button
          type="button"
          onClick={jump}
          className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border bg-popover px-3 py-1 text-xs font-medium shadow-md transition hover:bg-accent"
        >
          <ArrowDown className="size-3" /> Jump to latest
        </button>
      )}
    </div>
  );
}
