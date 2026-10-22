"use client";

import { memo, useMemo, useState, type ReactNode } from "react";
import { Pin, PinOff, Plus, Search, Snowflake, Unplug } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { parameterByQualifiedName, searchCatalog } from "@/lib/catalog/load";
import type { Catalog, CatalogParameter } from "@/lib/catalog/types";
import { formatValue } from "@/lib/ide/console-model";
import { PanelHeader } from "./ui";
import { useRunSession } from "./run-session";

/** Flashes an overlay when the value changes (children are never remounted, so editing is not interrupted). */
function Flash({
  value,
  children,
  className,
}: {
  value: unknown;
  children: ReactNode;
  className?: string;
}) {
  const [prev, setPrev] = useState(value);
  const [flash, setFlash] = useState(0);
  if (!Object.is(prev, value)) {
    setPrev(value);
    setFlash((f) => f + 1);
  }
  return (
    <span className={cn("relative block min-w-0", className)}>
      {children}
      {flash > 0 && (
        <span
          key={flash}
          aria-hidden
          className="ide-flash pointer-events-none absolute inset-0 rounded-md"
        />
      )}
    </span>
  );
}

function ValueEditor({
  param,
  catalog,
  value,
  onCommit,
}: {
  param: CatalogParameter | null;
  catalog: Catalog | null;
  value: unknown;
  onCommit(v: unknown): void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const enumMembers =
    param?.type === "enum" && param.enum && catalog
      ? catalog.paramEnums[param.enum]?.members
      : undefined;

  if (enumMembers?.length) {
    const current =
      value === undefined || value === null ? undefined : String(value);
    const known = enumMembers.some((m) => String(m.value) === current);
    return (
      <Select
        value={known ? current : undefined}
        onValueChange={(v) =>
          onCommit(enumMembers.find((m) => String(m.value) === v)?.value ?? v)
        }
      >
        <SelectTrigger
          size="sm"
          className="h-6 w-full min-w-0 gap-1 px-1.5 font-mono text-[11px]"
        >
          <SelectValue placeholder={current ?? "—"} />
        </SelectTrigger>
        <SelectContent position="popper" className="max-h-64">
          {enumMembers.map((m) => (
            <SelectItem
              key={m.name}
              value={String(m.value)}
              className="font-mono text-xs"
            >
              {String(m.value)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  if (param?.type === "bool" || typeof value === "boolean") {
    return (
      <Switch
        size="sm"
        checked={value === true}
        onCheckedChange={(c) => onCommit(c)}
        aria-label="Value"
      />
    );
  }
  const numeric = param
    ? param.type === "int" || param.type === "float"
    : typeof value === "number";
  const text = draft ?? (value === undefined ? "" : formatValue(value));
  const commit = () => {
    if (draft === null) return;
    const t = draft.trim();
    setDraft(null);
    if (t === "") return;
    if (numeric) {
      const n = Number(t);
      if (Number.isFinite(n))
        onCommit(param?.type === "int" ? Math.trunc(n) : n);
    } else onCommit(t);
  };
  return (
    <Input
      value={text}
      inputMode={numeric ? "decimal" : undefined}
      placeholder="—"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") setDraft(null);
      }}
      className="tabular h-6 rounded-md px-1.5 font-mono text-[11px] md:text-[11px]"
    />
  );
}

const Row = memo(function Row({
  q,
  name,
  param,
  catalog,
  value,
  state,
  pinned,
  referenced,
  onEdit,
  onUnpin,
}: {
  q: string;
  name: string;
  param: CatalogParameter | null;
  catalog: Catalog | null;
  value: unknown;
  state: "frozen" | "dropped" | null;
  pinned: boolean;
  referenced: boolean;
  onEdit(q: string, v: unknown): void;
  onUnpin(q: string): void;
}) {
  return (
    <li
      className={cn(
        "group grid grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)] items-center gap-2 border-b border-border/60 px-3 py-1.5 last:border-b-0",
        state && "bg-muted/40",
      )}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-1">
          <span
            className="truncate font-mono text-[11px] font-medium"
            title={q}
          >
            {name}
          </span>
          {state === "frozen" && (
            <Snowflake
              className="size-3 shrink-0 text-tone-info"
              aria-label="Frozen: no new samples"
            />
          )}
          {state === "dropped" && (
            <Unplug
              className="size-3 shrink-0 text-tone-neutral"
              aria-label="Dropped: nothing is received"
            />
          )}
        </div>
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <span className="truncate font-mono">
            {param?.subsystem ?? q.split("/")[2] ?? ""}
          </span>
          {referenced && (
            <span className="rounded bg-primary/10 px-1 text-primary">
              used
            </span>
          )}
          {pinned && (
            <button
              type="button"
              onClick={() => onUnpin(q)}
              aria-label={`Unpin ${name}`}
              className="opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100"
            >
              <PinOff className="size-3" />
            </button>
          )}
        </div>
      </div>
      <Flash value={value} className="min-w-0 px-0">
        <ValueEditor
          param={param}
          catalog={catalog}
          value={value}
          onCommit={(v) => onEdit(q, v)}
        />
      </Flash>
    </li>
  );
});

export function Inspector({ className }: { className?: string }) {
  const s = useRunSession();
  const { catalog, run } = s;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const frozen = useMemo(
    () =>
      new Set(
        s.faults
          .filter((f) => f.enabled && f.fault.kind === "freeze_param")
          .map((f) => (f.fault as { q: string }).q),
      ),
    [s.faults],
  );
  const dropped = useMemo(
    () =>
      new Set(
        s.faults
          .filter((f) => f.enabled && f.fault.kind === "drop_param")
          .map((f) => (f.fault as { q: string }).q),
      ),
    [s.faults],
  );

  const rows = useMemo(() => {
    const seen = new Set<string>();
    const out: {
      q: string;
      name: string;
      param: CatalogParameter | null;
      referenced: boolean;
      pinned: boolean;
    }[] = [];
    const add = (q: string, referenced: boolean, pinned: boolean) => {
      if (seen.has(q)) return;
      seen.add(q);
      const hit = catalog ? parameterByQualifiedName(catalog, q) : undefined;
      out.push({
        q,
        name: hit?.name ?? q.split("/").pop() ?? q,
        param: hit?.parameter ?? null,
        referenced,
        pinned,
      });
    };
    const refQs = new Set(s.referencedParams.map((r) => r.q));
    s.referencedParams.forEach((r) => add(r.q, true, s.pinned.includes(r.q)));
    s.pinned.forEach((q) => add(q, refQs.has(q), true));
    return out;
  }, [catalog, s.referencedParams, s.pinned]);

  const results = useMemo(
    () =>
      catalog && query.trim()
        ? searchCatalog(catalog, query, { kind: "parameter", limit: 25 })
        : [],
    [catalog, query],
  );

  const valueOf = (q: string): unknown =>
    q in run.telemetry
      ? run.telemetry[q]
      : q in s.edits
        ? s.edits[q]
        : s.simInitial[q];
  const live = run.status === "running" || run.status === "prompt";

  return (
    <section
      className={cn("flex h-full min-h-0 flex-col bg-card/40", className)}
      aria-label="Spacecraft inspector"
    >
      <PanelHeader
        title="Spacecraft inspector"
        actions={
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="xs"
                className="text-muted-foreground"
              >
                <Plus /> Add
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-0">
              <Command shouldFilter={false}>
                <CommandInput
                  placeholder="Search telemetry parameters…"
                  value={query}
                  onValueChange={setQuery}
                />
                <CommandList className="max-h-64">
                  {!query.trim() && (
                    <p className="px-3 py-5 text-center text-xs text-muted-foreground">
                      Type a name, subsystem or description.
                    </p>
                  )}
                  {query.trim() && results.length === 0 && (
                    <CommandEmpty>No parameter matches.</CommandEmpty>
                  )}
                  {results.length > 0 && (
                    <CommandGroup>
                      {results.map((r) => (
                        <CommandItem
                          key={r.q}
                          value={r.q}
                          onSelect={() => {
                            s.pin(r.q);
                            setOpen(false);
                            setQuery("");
                          }}
                        >
                          <Pin className="size-3.5 text-muted-foreground" />
                          <span className="truncate font-mono text-xs">
                            {r.name}
                          </span>
                          <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                            {r.subsystem}
                          </span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        }
      />
      <div className="ide-scroll min-h-0 flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 px-6 py-6 text-center">
            <Search className="size-5 text-muted-foreground" />
            <p className="text-xs font-medium">No telemetry pinned</p>
            <p className="text-[11px] leading-snug text-muted-foreground">
              Parameters your procedure reads appear here automatically. Add any
              other parameter to watch it, or override its value to steer the
              run.
            </p>
          </div>
        ) : (
          <ul>
            {rows.map((r) => (
              <Row
                key={r.q}
                q={r.q}
                name={r.name}
                param={r.param}
                catalog={catalog}
                value={valueOf(r.q)}
                state={
                  dropped.has(r.q)
                    ? "dropped"
                    : frozen.has(r.q)
                      ? "frozen"
                      : null
                }
                pinned={r.pinned}
                referenced={r.referenced}
                onEdit={s.editTelemetry}
                onUnpin={s.unpin}
              />
            ))}
          </ul>
        )}
      </div>
      <p className="shrink-0 border-t px-3 py-1.5 text-[10px] text-muted-foreground">
        {live
          ? "Live: edits reach the running spacecraft immediately."
          : "Edits apply from the start of the next run."}
      </p>
    </section>
  );
}
