"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Check,
  ChevronRight,
  Copy,
  CornerDownLeft,
  GripVertical,
  Loader2,
  Search,
  SearchX,
  Terminal,
  Gauge,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  getCatalogIndex,
  loadCatalog,
  searchCatalog,
  type SearchResult,
} from "@/lib/catalog/load";
import type { Catalog } from "@/lib/catalog/types";
import {
  commandSnippet,
  parameterSnippet,
  type Snippet,
} from "@/lib/ide/snippets";
import type { Mission } from "@/lib/data/types";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; catalog: Catalog };

function useCatalog(mission: Mission): State {
  const [state, setState] = useState<{ mission: Mission; value: State } | null>(
    null,
  );
  useEffect(() => {
    let cancelled = false;
    loadCatalog(mission).then(
      (catalog) =>
        !cancelled &&
        setState({ mission, value: { status: "ready", catalog } }),
      (e: unknown) =>
        !cancelled &&
        setState({
          mission,
          value: {
            status: "error",
            message: e instanceof Error ? e.message : String(e),
          },
        }),
    );
    return () => {
      cancelled = true;
    };
  }, [mission]);
  return state && state.mission === mission
    ? state.value
    : { status: "loading" };
}

function snippetFor(
  catalog: Catalog,
  r: SearchResult,
  source: string,
): Snippet | null {
  return r.kind === "command"
    ? commandSnippet(catalog, r.name, source)
    : parameterSnippet(catalog, r.name, source);
}

function Detail({
  catalog,
  r,
  onInsert,
  source,
}: {
  catalog: Catalog;
  r: SearchResult;
  onInsert(s: Snippet): void;
  source: string;
}) {
  const [copied, setCopied] = useState(false);
  const snippet = snippetFor(catalog, r, source);
  const cmd = r.kind === "command" ? catalog.commands[r.name] : null;
  const param = r.kind === "parameter" ? catalog.parameters[r.name] : null;
  const enumDef = param?.enum ? catalog.paramEnums[param.enum] : null;

  return (
    <div className="mx-2 mb-2 space-y-2.5 rounded-lg border bg-card p-2.5 text-xs">
      <p className="font-mono text-[10px] break-all text-muted-foreground">
        {r.q}
      </p>
      {r.description && (
        <p className="leading-snug text-foreground/90">{r.description}</p>
      )}

      {cmd && (
        <div className="space-y-1">
          <p className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
            Arguments
          </p>
          {cmd.args.length === 0 ? (
            <p className="text-muted-foreground">No arguments.</p>
          ) : (
            <ul className="space-y-0.5">
              {cmd.args.slice(0, 12).map((a) => (
                <li
                  key={a.name}
                  className="flex items-baseline gap-1.5 font-mono text-[11px]"
                >
                  <span
                    className={cn(
                      a.required ? "font-semibold" : "text-muted-foreground",
                    )}
                  >
                    {a.name}
                  </span>
                  <span className="text-muted-foreground">
                    : {a.type === "enum" ? a.enum : a.type}
                  </span>
                  {a.required && <span className="text-tone-danger">*</span>}
                  {!a.required &&
                    a.default !== undefined &&
                    a.default !== null && (
                      <span className="truncate text-muted-foreground/70">
                        = {String(a.default)}
                      </span>
                    )}
                </li>
              ))}
              {cmd.args.length > 12 && (
                <li className="text-[11px] text-muted-foreground">
                  + {cmd.args.length - 12} more
                </li>
              )}
            </ul>
          )}
        </div>
      )}
      {param && (
        <div className="space-y-1">
          <p className="font-mono text-[11px]">
            <span className="text-muted-foreground">type</span>{" "}
            {param.type === "enum" ? param.enum : param.type}{" "}
            <span className="text-muted-foreground">· {param.kind}</span>
          </p>
          {enumDef && (
            <div className="flex flex-wrap gap-1">
              {enumDef.members.slice(0, 8).map((m) => (
                <span
                  key={m.name}
                  className="rounded border bg-muted/50 px-1 font-mono text-[10px]"
                  title={m.name}
                >
                  {String(m.value)}
                </span>
              ))}
              {enumDef.members.length > 8 && (
                <span className="text-[10px] text-muted-foreground">
                  +{enumDef.members.length - 8}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {snippet && (
        <pre className="ide-scroll overflow-x-auto rounded-md border bg-muted/40 p-2 font-mono text-[10.5px] leading-relaxed">
          {snippet.text}
        </pre>
      )}
      <div className="flex items-center gap-1.5">
        <Button
          size="xs"
          onClick={() => snippet && onInsert(snippet)}
          disabled={!snippet}
        >
          <CornerDownLeft /> Insert at cursor
        </Button>
        <Button
          size="xs"
          variant="outline"
          disabled={!snippet}
          onClick={() => {
            if (!snippet) return;
            void navigator.clipboard?.writeText(snippet.text).then(
              () => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              },
              () => toast.error("Could not copy"),
            );
          }}
        >
          {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}

function Group({
  title,
  icon,
  items,
  open,
  onToggle,
  catalog,
  onInsert,
  getSource,
}: {
  title: string;
  icon: React.ReactNode;
  items: SearchResult[];
  open: string | null;
  onToggle(q: string): void;
  catalog: Catalog;
  onInsert(s: Snippet): void;
  getSource(): string;
}) {
  if (!items.length) return null;
  return (
    <div>
      <p className="sticky top-0 z-10 flex items-center gap-1.5 bg-background/95 px-3 py-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase backdrop-blur">
        {icon} {title}{" "}
        <span className="tabular opacity-60">{items.length}</span>
      </p>
      <ul>
        {items.map((r) => {
          const isOpen = open === r.q;
          return (
            <li key={r.q}>
              <div
                draggable
                onDragStart={(e) => {
                  const s = snippetFor(catalog, r, getSource());
                  if (!s) return e.preventDefault();
                  e.dataTransfer.setData("text/plain", s.text);
                  e.dataTransfer.effectAllowed = "copy";
                }}
                className={cn(
                  "group flex items-start gap-1 px-1.5 transition-colors hover:bg-muted/60",
                  isOpen && "bg-muted/50",
                )}
              >
                <GripVertical
                  className="mt-2 size-3 shrink-0 cursor-grab text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/60"
                  aria-hidden
                />
                <button
                  type="button"
                  onClick={() => onToggle(r.q)}
                  aria-expanded={isOpen}
                  className="min-w-0 flex-1 py-1.5 text-left outline-none focus-visible:underline"
                >
                  <span className="flex items-center gap-1.5">
                    <ChevronRight
                      className={cn(
                        "size-3 shrink-0 text-muted-foreground transition-transform",
                        isOpen && "rotate-90",
                      )}
                    />
                    <span className="truncate font-mono text-xs font-medium">
                      {r.name}
                    </span>
                    <span className="ml-auto shrink-0 rounded border px-1 font-mono text-[9px] text-muted-foreground">
                      {r.subsystem}
                    </span>
                  </span>
                  {r.description && !isOpen && (
                    <span className="mt-0.5 block truncate pl-4.5 text-[11px] text-muted-foreground">
                      {r.description}
                    </span>
                  )}
                </button>
              </div>
              {isOpen && (
                <Detail
                  catalog={catalog}
                  r={r}
                  onInsert={onInsert}
                  source={getSource()}
                />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function CatalogPanel({
  mission,
  getSource,
  onInsert,
}: {
  mission: Mission;
  getSource(): string;
  onInsert(s: Snippet): void;
}) {
  const state = useCatalog(mission);
  const [query, setQuery] = useState("");
  const [subsystem, setSubsystem] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const deferred = useDeferredValue(query);

  const catalog = state.status === "ready" ? state.catalog : null;
  const subsystems = useMemo(
    () => (catalog ? getCatalogIndex(catalog).subsystems : []),
    [catalog],
  );
  const results = useMemo(() => {
    if (!catalog) return [];
    if (!deferred.trim() && !subsystem) return [];
    return searchCatalog(catalog, deferred, {
      subsystem: subsystem ?? undefined,
      limit: 120,
    });
  }, [catalog, deferred, subsystem]);

  const commands = results.filter((r) => r.kind === "command");
  const parameters = results.filter((r) => r.kind === "parameter");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-2 border-b p-2.5">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${mission} commands & parameters`}
            aria-label="Search the TM/TC catalog"
            className="h-8 pl-8 text-xs md:text-xs"
          />
        </div>
        {subsystems.length > 0 && (
          <div className="ide-scroll -mx-0.5 flex gap-1 overflow-x-auto px-0.5 pb-1">
            {subsystems.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={subsystem === s}
                onClick={() => setSubsystem((cur) => (cur === s ? null : s))}
                className={cn(
                  "shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] transition-colors",
                  subsystem === s
                    ? "border-primary/50 bg-primary/10 text-primary"
                    : "text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                )}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="ide-scroll min-h-0 flex-1 overflow-y-auto pb-6">
        {state.status === "loading" && (
          <p className="flex items-center justify-center gap-2 px-4 py-10 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Loading the {mission}{" "}
            catalog…
          </p>
        )}
        {state.status === "error" && (
          <p className="px-4 py-10 text-center text-xs text-tone-danger">
            {state.message}
          </p>
        )}
        {catalog && !deferred.trim() && !subsystem && (
          <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <span className="flex size-10 items-center justify-center rounded-full border bg-muted/50 text-muted-foreground">
              <BookOpen className="size-4.5" />
            </span>
            <p className="text-sm font-medium">
              Find a telecommand or parameter
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {Object.keys(catalog.commands).length.toLocaleString()} commands ·{" "}
              {Object.keys(catalog.parameters).length.toLocaleString()}{" "}
              parameters. Search by name, qualified path or description, then
              insert a ready-to-edit call — or drag a row into the editor.
            </p>
            <p className="font-mono text-[10px] text-muted-foreground/70">
              {catalog.source}
            </p>
          </div>
        )}
        {catalog && (deferred.trim() || subsystem) && results.length === 0 && (
          <div className="flex flex-col items-center gap-1.5 px-6 py-10 text-center">
            <SearchX className="size-5 text-muted-foreground" />
            <p className="text-sm font-medium">No matches</p>
            <p className="text-xs text-muted-foreground">
              Try a shorter name or part of the qualified path, e.g. “/EPS/”.
            </p>
          </div>
        )}
        {catalog && (
          <>
            <Group
              title="Commands"
              icon={<Terminal className="size-3" />}
              items={commands}
              open={open}
              onToggle={(q) => setOpen((o) => (o === q ? null : q))}
              catalog={catalog}
              onInsert={onInsert}
              getSource={getSource}
            />
            <Group
              title="Parameters"
              icon={<Gauge className="size-3" />}
              items={parameters}
              open={open}
              onToggle={(q) => setOpen((o) => (o === q ? null : q))}
              catalog={catalog}
              onInsert={onInsert}
              getSource={getSource}
            />
          </>
        )}
      </div>
    </div>
  );
}
