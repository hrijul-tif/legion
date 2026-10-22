"use client";

import { useSyncExternalStore } from "react";
import type { CursorStore } from "@/lib/ide/cursor-store";
import { AlertCircle, Check, Loader2, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { getLangClient, type ComponentState } from "@/lib/editor/lang-client";
import type { LangStatus } from "@/lib/editor/lang-protocol";
import type { Catalog } from "@/lib/catalog/types";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { shortHash } from "@/lib/lifecycle";

function Pill({
  label,
  state,
  error,
}: {
  label: string;
  state: ComponentState;
  error?: string;
}) {
  const icon =
    state === "ready" ? (
      <Check className="size-3 text-tone-success" />
    ) : state === "error" ? (
      <AlertCircle className="size-3 text-tone-danger" />
    ) : (
      <Loader2
        className={cn("size-3", state === "loading" && "animate-spin")}
      />
    );
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex items-center gap-1",
            state === "error" && "text-tone-danger",
          )}
        >
          {label}
          {icon}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">
        {label}:{" "}
        {state === "idle"
          ? "waiting to start"
          : state === "loading"
            ? "loading…"
            : state === "ready"
              ? "ready"
              : (error ?? "failed to load")}
      </TooltipContent>
    </Tooltip>
  );
}

export function LangPills() {
  const client = getLangClient();
  const status: LangStatus = useSyncExternalStore(
    client.subscribe,
    client.getStatus,
    client.getServerStatus,
  );
  return (
    <span className="flex items-center gap-3">
      <Pill label="Ruff" state={status.ruff} error={status.errors.ruff} />
      <Pill label="Python" state={status.python} error={status.errors.python} />
      <Pill label="Jedi" state={status.jedi} error={status.errors.jedi} />
    </span>
  );
}

/** "mos-framework @ 7379fb46 (generated …)" -> "mos-framework 7379fb46" */
export function catalogLabel(c: Catalog | null, mission: string): string {
  if (!c) return `${mission} MDB · loading…`;
  const m = /^(.*?)\s*@\s*(\S+)/.exec(c.source);
  return `${mission} MDB · ${m ? `${m[1]} ${m[2]}` : c.source}`;
}

function CursorText({ store }: { store: CursorStore }) {
  const { line, column } = useSyncExternalStore(
    store.subscribe,
    store.get,
    store.get,
  );
  return (
    <span className="tabular font-mono">
      Ln {line}, Col {column}
    </span>
  );
}

export function StatusBar({
  cursor,
  mission,
  catalog,
  errors,
  warnings,
  onProblems,
  sha,
  autosave,
}: {
  cursor: CursorStore;
  mission: string;
  catalog: Catalog | null;
  errors: number;
  warnings: number;
  onProblems(): void;
  sha: string | null;
  autosave: boolean;
}) {
  return (
    <footer
      className="flex h-6 shrink-0 items-center justify-between gap-4 border-t bg-card/70 px-3 text-[11px] text-muted-foreground"
      aria-label="Status bar"
    >
      <div className="flex min-w-0 items-center gap-4">
        <CursorText store={cursor} />
        <span className="hidden sm:inline">Python 3.14 · Pyodide</span>
        <span className="hidden md:inline">
          <LangPills />
        </span>
      </div>
      <div className="flex min-w-0 items-center gap-4">
        <span
          className="hidden truncate font-mono lg:inline"
          title={catalog?.source}
        >
          {catalogLabel(catalog, mission)}
        </span>
        <button
          type="button"
          onClick={onProblems}
          className="inline-flex items-center gap-2 rounded px-1 hover:bg-muted hover:text-foreground"
          aria-label={`${errors} errors, ${warnings} warnings. Open problems`}
        >
          <span
            className={cn(
              "inline-flex items-center gap-1",
              errors > 0 && "text-tone-danger",
            )}
          >
            <AlertCircle className="size-3" />
            <span className="tabular">{errors}</span>
          </span>
          <span
            className={cn(
              "inline-flex items-center gap-1",
              warnings > 0 && "text-tone-warn",
            )}
          >
            <TriangleAlert className="size-3" />
            <span className="tabular">{warnings}</span>
          </span>
        </button>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="hidden font-mono sm:inline">
              sha256 {sha ? shortHash(sha) : "…"}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top">
            sha256 of the buffer as it is on screen{sha ? `: ${sha}` : ""}
          </TooltipContent>
        </Tooltip>
        {autosave && <span className="hidden sm:inline">Autosave on</span>}
      </div>
    </footer>
  );
}
