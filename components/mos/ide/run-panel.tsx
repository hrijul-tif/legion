"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  CircleAlert,
  Cpu,
  Loader2,
  Play,
  Radio,
  ShieldAlert,
  Square,
  Timer,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { WARP_CHOICES } from "@/lib/ide/run-defaults";
import type { Outcome } from "@/lib/sandbox/types";
import { ArgsForm } from "./args-form";
import { FaultsBuilder } from "./faults-builder";
import { useRunSession, type RunSession } from "./run-session";
import { Kbd, PanelHeader, useModLabel } from "./ui";

const OUTCOME_LABEL: Record<Outcome, { label: string; tone: string }> = {
  completed: { label: "Completed", tone: "text-tone-success" },
  skipped: { label: "Skipped", tone: "text-tone-warn" },
  stopped: { label: "Stopped", tone: "text-tone-warn" },
  choose: { label: "Chose another procedure", tone: "text-tone-warn" },
  error: { label: "Failed", tone: "text-tone-danger" },
};

function useElapsed(active: boolean): number {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    if (!active) return;
    const start = Date.now();
    const id = setInterval(
      () => setSecs(Math.floor((Date.now() - start) / 1000)),
      500,
    );
    return () => {
      clearInterval(id);
      setSecs(0);
    };
  }, [active]);
  return secs;
}

export function RunStatus({
  session,
  compact = false,
}: {
  session: RunSession;
  compact?: boolean;
}) {
  const { run } = session;
  const booting = run.status === "booting";
  const elapsed = useElapsed(booting);
  let text: string;
  let icon = <Radio className="size-3.5" />;
  let tone = "text-muted-foreground";
  switch (run.status) {
    case "idle":
      text = "Ready";
      break;
    case "booting":
      text =
        elapsed < 3
          ? "Loading Python runtime (Pyodide)…"
          : elapsed < 9
            ? "Unpacking the mos-framework shim…"
            : "Still loading — the first run downloads the runtime, later runs are instant";
      icon = <Loader2 className="size-3.5 animate-spin" />;
      tone = "text-tone-info";
      break;
    case "running":
      text = "Running";
      icon = <Loader2 className="size-3.5 animate-spin" />;
      tone = "text-tone-info";
      break;
    case "prompt":
      text = "Waiting for you";
      icon = <CircleAlert className="size-3.5" />;
      tone = "text-tone-warn";
      break;
    case "done": {
      const o = run.outcome ? OUTCOME_LABEL[run.outcome.outcome] : null;
      text = o?.label ?? "Done";
      tone = o?.tone ?? "";
      icon =
        run.outcome?.outcome === "completed" ? (
          <Check className="size-3.5" />
        ) : (
          <AlertTriangle className="size-3.5" />
        );
      break;
    }
  }
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        tone,
        run.status === "prompt" &&
          "ide-pulse-warn border-tone-warn/40 bg-tone-warn/10",
        compact && "border-transparent px-0",
      )}
    >
      {icon}
      <span className={cn("truncate", booting && "max-w-56")}>{text}</span>
    </span>
  );
}

function TargetSelect({ session }: { session: RunSession }) {
  const { targets, target } = session;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 w-full justify-start gap-2 text-xs"
          disabled={session.busy}
        >
          <Cpu className="size-3.5 text-primary" />
          <span className="truncate">{target.label}</span>
          <span className="ml-auto text-[10px] text-muted-foreground">
            Target
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        {targets.map((t) => {
          const item = (
            <DropdownMenuItem
              key={t.target.id}
              disabled={!t.available}
              onSelect={() => session.setTargetId(t.target.id)}
              className="flex-col items-start gap-0.5"
            >
              <span className="flex w-full items-center gap-2 text-xs font-medium">
                {t.target.label}
                {t.target.id === target.id && (
                  <Check className="ml-auto size-3.5" />
                )}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {t.available ? t.target.hint : t.reason}
              </span>
            </DropdownMenuItem>
          );
          return t.available ? (
            item
          ) : (
            <Tooltip key={t.target.id}>
              <TooltipTrigger asChild>
                <div>{item}</div>
              </TooltipTrigger>
              <TooltipContent side="left">{t.reason}</TooltipContent>
            </Tooltip>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function WarpControl({ session }: { session: RunSession }) {
  return (
    <div className="space-y-1.5">
      <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
        <Timer className="size-3" /> Time warp
      </span>
      <div
        role="radiogroup"
        aria-label="Time warp"
        className="grid grid-cols-4 gap-0.5 rounded-lg bg-muted p-0.5"
      >
        {WARP_CHOICES.map((w) => {
          const on = w.value === session.warp;
          return (
            <Tooltip key={w.label}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => session.setWarp(w.value)}
                  className={cn(
                    "h-6 rounded-md text-[11px] font-medium transition-colors",
                    on
                      ? "bg-background text-foreground shadow-sm ring-1 ring-border"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {w.label}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{w.hint}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

function SandboxUnavailable({ message }: { message: string | null }) {
  return (
    <div className="space-y-2 rounded-lg border border-tone-danger/30 bg-tone-danger/[0.07] p-3 text-xs">
      <p className="flex items-center gap-1.5 font-medium text-tone-danger">
        <ShieldAlert className="size-4" /> The run sandbox cannot start in this
        tab
      </p>
      <p className="leading-relaxed text-muted-foreground">
        Procedures run in a Python (WebAssembly) worker that needs{" "}
        <code className="font-mono text-foreground">SharedArrayBuffer</code>,
        which browsers only provide to cross-origin isolated pages. This page
        was served without the{" "}
        <code className="font-mono text-foreground">
          Cross-Origin-Opener-Policy: same-origin
        </code>{" "}
        and{" "}
        <code className="font-mono text-foreground">
          Cross-Origin-Embedder-Policy: require-corp
        </code>{" "}
        headers (or it is embedded in another site).
      </p>
      <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
        <li>Open MOS directly in its own tab, not inside a frame.</li>
        <li>Hard-reload (Shift + reload) after the server restarts.</li>
        <li>Behind a proxy? Make sure it forwards both headers.</li>
      </ul>
      {message && (
        <p className="rounded bg-background/60 p-1.5 font-mono text-[10px] break-words text-muted-foreground">
          {message}
        </p>
      )}
    </div>
  );
}

export function RunPanel({
  className,
  hideHeader = false,
}: {
  className?: string;
  hideHeader?: boolean;
}) {
  const session = useRunSession();
  const mod = useModLabel();
  const { run } = session;

  return (
    <section
      className={cn("flex h-full min-h-0 flex-col bg-card/40", className)}
      aria-label="Run"
    >
      {!hideHeader && (
        <PanelHeader title="Run" actions={<RunStatus session={session} />} />
      )}
      <div className="ide-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3">
        <TargetSelect session={session} />
        {session.target.Panel && <session.target.Panel />}

        {run.unavailable && <SandboxUnavailable message={run.sandboxError} />}

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
              Arguments
            </span>
            {session.signatureStale && (
              <span className="text-[10px] text-tone-warn">
                file does not parse — showing last signature
              </span>
            )}
          </div>
          <ArgsForm
            specs={session.specs}
            values={session.values}
            errors={session.errors}
            showErrors={session.showErrors}
            disabled={session.busy}
            onChange={session.setValue}
          />
        </div>

        {session.target.capabilities.warp && <WarpControl session={session} />}
        {session.target.capabilities.faults && (
          <FaultsBuilder
            faults={session.faults}
            catalog={session.catalog}
            referencedParams={session.referencedParams}
            referencedCommands={session.referencedCommands}
            onAdd={session.addFault}
            onRemove={session.removeFault}
            onToggle={session.toggleFault}
          />
        )}
      </div>

      <div className="shrink-0 space-y-1.5 border-t bg-card/70 p-3">
        {session.busy ? (
          <Button
            variant="destructive"
            className="h-9 w-full gap-2"
            onClick={session.stop}
          >
            <Square className="size-3.5 fill-current" /> Stop
            <Kbd className="ml-1 border-destructive/30 bg-transparent text-destructive/80">
              {mod}.
            </Kbd>
          </Button>
        ) : (
          <Button
            className="h-9 w-full gap-2"
            onClick={() => void session.start()}
            disabled={!session.canRun}
          >
            <Play className="size-3.5 fill-current" /> Run
            <Kbd className="ml-1 border-primary-foreground/30 bg-transparent text-primary-foreground/80">
              {mod}↵
            </Kbd>
          </Button>
        )}
        {session.disabledReason && !session.busy && (
          <p className="text-center text-[11px] text-muted-foreground">
            {session.disabledReason}
          </p>
        )}
        <p className="text-center text-[10px] text-muted-foreground">
          {session.persist === "saved"
            ? "Saved to run history"
            : session.persist === "saving"
              ? "Saving to run history…"
              : session.persist === "failed"
                ? "Could not save this run to history"
                : "Runs are recorded and can be attached as test evidence"}
        </p>
      </div>
    </section>
  );
}
