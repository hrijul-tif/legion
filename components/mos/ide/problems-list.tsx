"use client";

import { CheckCircle2, Info, OctagonX, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Problem } from "@/lib/ide/monaco-ide";

const ICON = {
  error: { icon: OctagonX, tone: "text-tone-danger" },
  warning: { icon: TriangleAlert, tone: "text-tone-warn" },
  info: { icon: Info, tone: "text-tone-info" },
} as const;

const SOURCE_LABEL: Record<string, string> = {
  ruff: "Ruff",
  mos: "MOS rule",
  "mos-catalog": "MDB",
};

export function ProblemsList({
  problems,
  onReveal,
  empty,
}: {
  problems: Problem[];
  onReveal(p: Problem): void;
  empty?: string;
}) {
  if (!problems.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1.5 px-6 py-8 text-center">
        <CheckCircle2 className="size-5 text-tone-success" />
        <p className="text-sm font-medium">No problems</p>
        <p className="max-w-xs text-xs text-muted-foreground">
          {empty ??
            "Syntax, MOS rules, catalog usage and Ruff checks all pass."}
        </p>
      </div>
    );
  }
  return (
    <ul className="ide-scroll h-full overflow-y-auto py-1">
      {problems.map((p) => {
        const { icon: Icon, tone } = ICON[p.severity];
        return (
          <li key={p.key}>
            <button
              type="button"
              onClick={() => onReveal(p)}
              className="grid w-full grid-cols-[1rem_minmax(0,1fr)_auto] items-start gap-2 px-3 py-1.5 text-left transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
            >
              <Icon
                className={cn("mt-0.5 size-3.5", tone)}
                aria-label={p.severity}
              />
              <span className="min-w-0">
                <span className="block text-xs leading-snug break-words">
                  {p.message}
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
                  <span>{SOURCE_LABEL[p.owner] ?? p.source}</span>
                  {p.code && (
                    <span className="rounded border px-1">{p.code}</span>
                  )}
                </span>
              </span>
              <span className="tabular pt-0.5 font-mono text-[10px] text-muted-foreground">
                {p.line}:{p.column}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
