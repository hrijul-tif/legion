"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  CircleSlash,
  OctagonX,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  countEvents,
  errorLine,
  formatDuration,
  parseTraceback,
} from "@/lib/ide/console-model";
import { useRunSession } from "./run-session";

const TONES = {
  success: {
    box: "border-tone-success/35 bg-tone-success/[0.08]",
    text: "text-tone-success",
    icon: CheckCircle2,
  },
  warn: {
    box: "border-tone-warn/35 bg-tone-warn/[0.08]",
    text: "text-tone-warn",
    icon: CircleSlash,
  },
  danger: {
    box: "border-tone-danger/35 bg-tone-danger/[0.08]",
    text: "text-tone-danger",
    icon: OctagonX,
  },
} as const;

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: string;
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className={cn("tabular text-sm font-semibold", tone)}>{value}</span>
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </div>
  );
}

export function OutcomeBanner({
  onRevealLine,
}: {
  onRevealLine?(line: number): void;
}) {
  const { run, answers } = useRunSession();
  const [showTb, setShowTb] = useState(false);
  const reduce = useReducedMotion();
  const done = run.outcome;
  if (run.status !== "done" || !done) return null;

  const counts = countEvents(run.events);
  const tone =
    done.outcome === "completed"
      ? TONES.success
      : done.outcome === "error"
        ? TONES.danger
        : TONES.warn;
  const Icon = tone.icon;
  const title =
    done.outcome === "completed"
      ? "Completed"
      : done.outcome === "skipped"
        ? "Skipped by the operator"
        : done.outcome === "stopped"
          ? "Stopped"
          : done.outcome === "choose"
            ? "Operator asked to choose another procedure"
            : run.unavailable
              ? "Could not start the sandbox"
              : "Failed";
  const line = errorLine(done.traceback);
  const tb = done.traceback ? parseTraceback(done.traceback) : [];
  const wall = done.wallMs / 1000;

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 420, damping: 34 }}
      role="status"
      className={cn("shrink-0 border-b px-4 py-2.5", tone.box)}
    >
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
        <div
          className={cn(
            "flex items-center gap-2 text-sm font-semibold",
            tone.text,
          )}
        >
          <Icon className="size-4" />
          {title}
        </div>
        {!run.unavailable && (
          <>
            <p className="text-xs text-muted-foreground">
              <span className="tabular font-medium text-foreground">
                {formatDuration(done.virtualSeconds)}
              </span>{" "}
              of spacecraft time in{" "}
              <span className="tabular font-medium text-foreground">
                {formatDuration(wall)}
              </span>
            </p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <Stat
                label={counts.commands === 1 ? "command sent" : "commands sent"}
                value={counts.commands}
              />
              {counts.commandsFailed > 0 && (
                <Stat
                  label="not completed"
                  value={counts.commandsFailed}
                  tone="text-tone-danger"
                />
              )}
              <Stat
                label={counts.tmChecks === 1 ? "TM read" : "TM reads"}
                value={counts.tmChecks}
              />
              <Stat
                label={
                  Object.keys(answers).length === 1
                    ? "prompt answered"
                    : "prompts answered"
                }
                value={Object.keys(answers).length}
              />
              {counts.warnings > 0 && (
                <Stat
                  label="warnings"
                  value={counts.warnings}
                  tone="text-tone-warn"
                />
              )}
              {counts.errors > 0 && (
                <Stat
                  label="errors"
                  value={counts.errors}
                  tone="text-tone-danger"
                />
              )}
            </div>
          </>
        )}
      </div>

      {done.outcome === "error" && done.error && (
        <div className="mt-2 space-y-1.5">
          <p className="font-mono text-xs break-words text-foreground">
            {done.error}
          </p>
          {tb.length > 0 && (
            <>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setShowTb((v) => !v)}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
                >
                  <ChevronDown
                    className={cn(
                      "size-3 transition-transform",
                      !showTb && "-rotate-90",
                    )}
                  />
                  {showTb ? "Hide traceback" : "Show traceback"}
                </button>
                {line && onRevealLine && (
                  <button
                    type="button"
                    onClick={() => onRevealLine(line)}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                  >
                    Go to line {line} <ArrowUpRight className="size-3" />
                  </button>
                )}
              </div>
              {showTb && (
                <pre className="ide-scroll max-h-44 overflow-auto rounded-md border bg-background/70 p-2 font-mono text-[11px] leading-relaxed">
                  {tb.map((l, i) =>
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
            </>
          )}
        </div>
      )}
      {done.outcome !== "error" &&
        done.error &&
        done.outcome !== "completed" && (
          <p className="mt-1 text-xs text-muted-foreground">{done.error}</p>
        )}
    </motion.div>
  );
}
