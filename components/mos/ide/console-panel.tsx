"use client";

import { useState } from "react";
import { Activity, ListChecks, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";
import { DEFAULT_FILTER, type ConsoleFilter } from "@/lib/ide/console-model";
import type { Problem } from "@/lib/ide/monaco-ide";
import { ConsoleToolbar, ConsoleView, useConsoleRows } from "./console-view";
import { OutcomeBanner } from "./outcome-banner";
import { PromptBanner } from "./prompt-banner";
import { ProblemsList } from "./problems-list";
import { TimelineView } from "./timeline-view";

export type ConsoleTab = "console" | "timeline" | "problems";

function TabButton({
  active,
  onClick,
  icon,
  children,
  badge,
}: {
  active: boolean;
  onClick(): void;
  icon: React.ReactNode;
  children: React.ReactNode;
  badge?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "relative flex h-9 items-center gap-1.5 px-3 text-xs font-medium transition-colors outline-none focus-visible:bg-muted/60",
        active
          ? "text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {children}
      {badge}
      {active && (
        <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary" />
      )}
    </button>
  );
}

/** Bottom panel: console, timeline and problems, with the operator prompt and run outcome pinned above. */
export function ConsolePanel({
  tab,
  onTab,
  problems,
  onRevealLine,
  onRevealProblem,
}: {
  tab: ConsoleTab;
  onTab(t: ConsoleTab): void;
  problems: Problem[] | null;
  onRevealLine?(line: number): void;
  onRevealProblem?(p: Problem): void;
}) {
  const [filter, setFilter] = useState<ConsoleFilter>(DEFAULT_FILTER);
  const { all, rows } = useConsoleRows(filter);
  const errorCount =
    problems?.filter((p) => p.severity === "error").length ?? 0;
  const warnCount =
    problems?.filter((p) => p.severity === "warning").length ?? 0;

  return (
    <section
      className="flex h-full min-h-0 flex-col bg-background"
      aria-label="Console"
    >
      <div
        className="flex shrink-0 items-center justify-between gap-2 border-b pr-2"
        role="tablist"
      >
        <div className="flex">
          <TabButton
            active={tab === "console"}
            onClick={() => onTab("console")}
            icon={<Terminal className="size-3.5" />}
          >
            Console
          </TabButton>
          <TabButton
            active={tab === "timeline"}
            onClick={() => onTab("timeline")}
            icon={<Activity className="size-3.5" />}
          >
            Timeline
          </TabButton>
          {problems && (
            <TabButton
              active={tab === "problems"}
              onClick={() => onTab("problems")}
              icon={<ListChecks className="size-3.5" />}
              badge={
                (errorCount > 0 || warnCount > 0) && (
                  <span
                    className={cn(
                      "tabular rounded-full px-1.5 text-[10px] font-semibold",
                      errorCount
                        ? "bg-tone-danger/15 text-tone-danger"
                        : "bg-tone-warn/15 text-tone-warn",
                    )}
                  >
                    {errorCount || warnCount}
                  </span>
                )
              }
            >
              Problems
            </TabButton>
          )}
        </div>
        {tab === "console" && (
          <ConsoleToolbar filter={filter} onFilter={setFilter} rows={all} />
        )}
      </div>
      <PromptBanner />
      <OutcomeBanner onRevealLine={onRevealLine} />
      <div className="min-h-0 flex-1">
        {tab === "console" && (
          <ConsoleView rows={rows} onRevealLine={onRevealLine} />
        )}
        {tab === "timeline" && <TimelineView />}
        {tab === "problems" && problems && onRevealProblem && (
          <ProblemsList problems={problems} onReveal={onRevealProblem} />
        )}
      </div>
    </section>
  );
}
