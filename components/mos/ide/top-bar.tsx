"use client";

import Link from "next/link";
import {
  Check,
  ChevronDown,
  CloudOff,
  GitCompareArrows,
  GitFork,
  Loader2,
  Play,
  Send,
  Square,
  WandSparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StateBadge } from "@/components/mos/state-badge";
import { RelativeTime } from "@/components/mos/time";
import { cn } from "@/lib/utils";
import type { SaveState } from "@/lib/ide/save-queue";
import type { IdeCodeRef, IdeProcedure, IdeSnapshot } from "@/lib/ide/types";
import { PresenceStack } from "./presence";
import { ShortcutsPopover } from "./shortcuts-popover";
import { useRunSession } from "./run-session";
import { Kbd, Tip, useModLabel } from "./ui";
import type { PresenceState } from "./use-presence";

export interface CompareChoice {
  kind: "parent" | "prod" | "snapshot";
  ref: IdeCodeRef;
  label: string;
}

export function SaveStatus({ state }: { state: SaveState }) {
  let icon = <Check className="size-3.5 text-tone-success" />;
  let text = "Saved";
  let tone = "text-muted-foreground";
  if (state.status === "saving") {
    icon = <Loader2 className="size-3.5 animate-spin" />;
    text = "Saving…";
  } else if (state.status === "unsaved") {
    icon = <span className="mx-1 size-1.5 rounded-full bg-tone-warn" />;
    text = "Unsaved changes";
  } else if (state.status === "offline") {
    icon = <CloudOff className="size-3.5" />;
    text = state.fatal ? "Cannot save" : "Offline — kept locally";
    tone = "text-tone-danger";
  }
  return (
    <Tip
      label={
        state.status === "offline"
          ? (state.error ??
            "Could not reach the server; your text is kept in this browser and retried")
          : "Changes are saved automatically"
      }
    >
      <span
        role="status"
        aria-live="polite"
        className={cn("inline-flex items-center gap-1.5 text-xs", tone)}
      >
        {icon}
        <span>{text}</span>
        {state.status === "saved" && state.savedAt && (
          <RelativeTime
            date={new Date(state.savedAt)}
            className="text-muted-foreground/70"
          />
        )}
      </span>
    </Tip>
  );
}

export function TopBar({
  procedure,
  snapshot,
  readOnly,
  save,
  presence,
  compare,
  parent,
  active,
  onCompareChoose,
  onCompareStop,
  onCompareFromHistory,
  onFormat,
  onSubmit,
  submitDisabledReason,
  layoutControls,
  shortcutsOpen,
  onShortcutsOpen,
}: {
  procedure: IdeProcedure;
  snapshot: IdeSnapshot;
  readOnly: boolean;
  save: SaveState;
  presence: PresenceState;
  compare: CompareChoice | null;
  parent: IdeCodeRef | null;
  active: IdeCodeRef | null;
  onCompareChoose(c: CompareChoice): void;
  onCompareStop(): void;
  onCompareFromHistory(): void;
  onFormat(): void;
  onSubmit(): void;
  submitDisabledReason: string | null;
  layoutControls: React.ReactNode;
  shortcutsOpen: boolean;
  onShortcutsOpen(o: boolean): void;
}) {
  const session = useRunSession();
  const mod = useModLabel();
  const activeIsParent = !!active && !!parent && active.id === parent.id;

  return (
    <header
      className="flex h-12 shrink-0 items-center justify-between gap-3 border-b bg-card/70 px-3"
      aria-label="Editor toolbar"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <nav
          aria-label="Breadcrumb"
          className="flex min-w-0 items-center gap-1.5 text-sm"
        >
          <Link
            href="/procedures"
            className="hidden rounded text-muted-foreground hover:text-foreground md:inline"
          >
            Procedures
          </Link>
          <span
            aria-hidden
            className="hidden text-muted-foreground/50 md:inline"
          >
            /
          </span>
          <Link
            href={`/procedures/${procedure.id}`}
            className="max-w-[26ch] truncate rounded font-mono text-[13px] font-semibold hover:underline"
            title={procedure.name}
          >
            {procedure.name}
          </Link>
          <span aria-hidden className="text-muted-foreground/50">
            /
          </span>
          <span className="truncate whitespace-nowrap text-muted-foreground">
            Working copy{" "}
            <span className="font-mono tabular font-medium text-foreground">
              #{snapshot.number}
            </span>
          </span>
        </nav>
        <StateBadge state={snapshot.state} size="xs" short />
        {snapshot.parentId && snapshot.parentNumber !== null && (
          <Link
            href={`/snapshots/${snapshot.parentId}`}
            className="hidden items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground lg:inline-flex"
            title={`This working copy was forked from #${snapshot.parentNumber}`}
          >
            <GitFork className="size-3" /> forked from{" "}
            <span className="font-mono">#{snapshot.parentNumber}</span>
          </Link>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <SaveStatus state={save} />
        <PresenceStack presence={presence} />
        <span className="h-5 w-px bg-border" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant={compare ? "secondary" : "ghost"}
              size="sm"
              className={cn("gap-1.5", compare && "text-tone-info")}
            >
              <GitCompareArrows />
              <span className="hidden xl:inline">
                {compare ? `vs ${compare.label}` : "Compare"}
              </span>
              <ChevronDown className="size-3 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel className="text-[11px]">
              Show changes against…
            </DropdownMenuLabel>
            <DropdownMenuItem
              disabled={!parent}
              onSelect={() =>
                parent &&
                onCompareChoose({
                  kind: "parent",
                  ref: parent,
                  label: `parent #${parent.number}`,
                })
              }
            >
              Parent{" "}
              {parent ? (
                <span className="font-mono">#{parent.number}</span>
              ) : (
                <span className="text-muted-foreground">
                  (none: first version)
                </span>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!active}
              onSelect={() =>
                active &&
                onCompareChoose({
                  kind: "prod",
                  ref: active,
                  label: `PROD #${active.number}`,
                })
              }
            >
              PROD{" "}
              {active ? (
                <span className="font-mono">#{active.number}</span>
              ) : (
                <span className="text-muted-foreground">
                  (nothing approved yet)
                </span>
              )}
              {activeIsParent && (
                <span className="ml-auto text-[10px] text-muted-foreground">
                  = parent
                </span>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onCompareFromHistory}>
              Another snapshot… (History)
            </DropdownMenuItem>
            {compare && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onCompareStop}>
                  <X /> Stop comparing
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <Tip label="Format with Ruff" keys={["⇧", "⌥", "F"]}>
          <Button
            variant="ghost"
            size="sm"
            onClick={onFormat}
            disabled={readOnly}
            className="gap-1.5"
          >
            <WandSparkles />
            <span className="hidden xl:inline">Format</span>
          </Button>
        </Tip>

        {session.busy ? (
          <Button
            variant="destructive"
            size="sm"
            onClick={session.stop}
            className="gap-1.5"
          >
            <Square className="size-3 fill-current" /> Stop
          </Button>
        ) : (
          <Tip label="Run against the mock spacecraft" keys={[mod, "↵"]}>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void session.start()}
              disabled={!session.canRun}
              className="gap-1.5"
            >
              <Play className="size-3 fill-current text-tone-success" /> Run
              <Kbd className="hidden lg:inline-flex">{mod}↵</Kbd>
            </Button>
          </Tip>
        )}

        <Tip
          label={
            submitDisabledReason ??
            "Freeze this working copy and send it to reviewers"
          }
        >
          <span>
            <Button
              size="sm"
              onClick={onSubmit}
              disabled={!!submitDisabledReason}
              className="gap-1.5"
            >
              <Send /> Submit for review
            </Button>
          </span>
        </Tip>
        <span className="h-5 w-px bg-border" />
        <div className="flex items-center">
          {layoutControls}
          <ShortcutsPopover
            open={shortcutsOpen}
            onOpenChange={onShortcutsOpen}
          />
        </div>
      </div>
    </header>
  );
}
