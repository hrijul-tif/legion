"use client";

import { useMemo } from "react";
import { CircleDot, FunctionSquare, Hash, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { parseOutline } from "@/lib/ide/outline";
import type { MosEntry } from "@/lib/editor/lang-protocol";

const KIND_TONE: Record<string, string> = {
  enum: "text-tone-progress",
  datetime: "text-tone-info",
  list: "text-tone-warn",
  bool: "text-tone-success",
  int: "text-foreground",
  float: "text-foreground",
  str: "text-foreground",
};

export function OutlinePanel({
  code,
  entry,
  onReveal,
}: {
  code: string;
  entry: MosEntry | null;
  onReveal(line: number): void;
}) {
  const outline = useMemo(() => parseOutline(code), [code]);
  const entryName = entry?.entrypoint ?? null;
  const entryFn = outline.functions.find((f) => f.name === entryName);
  const helpers = outline.functions.filter((f) => f.name !== entryName);

  if (!outline.functions.length && !outline.constants.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1.5 px-6 text-center">
        <FunctionSquare className="size-5 text-muted-foreground" />
        <p className="text-sm font-medium">Nothing to outline yet</p>
        <p className="text-xs text-muted-foreground">
          Define the entry function — one public function with fully annotated
          arguments.
        </p>
      </div>
    );
  }

  return (
    <div className="ide-scroll h-full overflow-y-auto pb-6">
      <p className="px-3 pt-2.5 pb-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
        Entry function
      </p>
      {entryFn && entry ? (
        <div className="px-1.5">
          <button
            type="button"
            onClick={() => onReveal(entryFn.line)}
            className="group flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-muted/60"
          >
            <Play className="size-3.5 shrink-0 fill-primary text-primary" />
            <span className="truncate font-mono text-xs font-semibold">
              {entryFn.name}
            </span>
            <span className="tabular ml-auto font-mono text-[10px] text-muted-foreground">
              {entryFn.line}
            </span>
          </button>
          <ul className="mb-1 ml-5 border-l pl-2">
            {entry.params.length === 0 && (
              <li className="py-1 text-[11px] text-muted-foreground">
                No arguments
              </li>
            )}
            {entry.params.map((p) => (
              <li key={p.name}>
                <button
                  type="button"
                  onClick={() => onReveal(entry.line ?? entryFn.line)}
                  className="flex w-full items-baseline gap-1.5 rounded px-1 py-0.5 text-left hover:bg-muted/60"
                >
                  <span className="font-mono text-[11px]">{p.name}</span>
                  <span
                    className={cn(
                      "truncate font-mono text-[10px]",
                      KIND_TONE[p.kind] ?? "text-muted-foreground",
                    )}
                  >
                    {p.annotation ?? "unannotated"}
                  </span>
                  {p.required && (
                    <span className="text-[10px] text-tone-danger">*</span>
                  )}
                  {p.default !== undefined && (
                    <span className="truncate font-mono text-[10px] text-muted-foreground">
                      = {JSON.stringify(p.default)}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="px-3 py-1.5 text-xs text-muted-foreground">
          {entry === null
            ? "No entry function found, or the file has a syntax error."
            : "—"}
        </p>
      )}

      {helpers.length > 0 && (
        <>
          <p className="px-3 pt-3 pb-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
            Helpers
          </p>
          <ul className="px-1.5">
            {helpers.map((f) => (
              <li key={`${f.name}:${f.line}`}>
                <button
                  type="button"
                  onClick={() => onReveal(f.line)}
                  className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-muted/60"
                >
                  <FunctionSquare className="size-3.5 shrink-0 text-muted-foreground" />
                  <span
                    className={cn(
                      "truncate font-mono text-xs",
                      f.isPrivate && "text-muted-foreground",
                    )}
                  >
                    {f.name}
                  </span>
                  <span className="truncate font-mono text-[10px] text-muted-foreground">
                    ({f.params.map((p) => p.name).join(", ")})
                  </span>
                  <span className="tabular ml-auto font-mono text-[10px] text-muted-foreground">
                    {f.line}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {outline.constants.length > 0 && (
        <>
          <p className="px-3 pt-3 pb-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
            Constants
          </p>
          <ul className="px-1.5">
            {outline.constants.map((c) => (
              <li key={c.name}>
                <button
                  type="button"
                  onClick={() => onReveal(c.line)}
                  className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-muted/60"
                >
                  <Hash className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="font-mono text-xs">{c.name}</span>
                  <span className="truncate font-mono text-[10px] text-muted-foreground">
                    {c.value}
                  </span>
                  <span className="tabular ml-auto font-mono text-[10px] text-muted-foreground">
                    {c.line}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="flex items-center gap-1.5 px-3 pt-4 text-[10px] text-muted-foreground">
        <CircleDot className="size-3" /> Updates as you type
      </p>
    </div>
  );
}
