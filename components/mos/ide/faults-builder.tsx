"use client";

import { useMemo, useState } from "react";
import {
  Ban,
  Clock,
  Plus,
  Snowflake,
  Trash2,
  TriangleAlert,
  Unplug,
  Zap,
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
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { searchCatalog } from "@/lib/catalog/load";
import type { Catalog } from "@/lib/catalog/types";
import type { Fault } from "@/lib/sandbox/types";
import type { ReferencedItem } from "@/lib/ide/refs";
import type { FaultItem } from "./run-session";

type PickerMode = "freeze" | "drop" | "cmd_fail" | "cmd_timeout";

const PICKER: Record<
  PickerMode,
  {
    title: string;
    kind: "parameter" | "command";
    build(q: string, name: string): { label: string; fault: Fault };
  }
> = {
  freeze: {
    title: "Freeze which parameter?",
    kind: "parameter",
    build: (q, name) => ({
      label: `Freeze ${name}`,
      fault: { kind: "freeze_param", q },
    }),
  },
  drop: {
    title: "Drop which parameter?",
    kind: "parameter",
    build: (q, name) => ({
      label: `Drop ${name}`,
      fault: { kind: "drop_param", q },
    }),
  },
  cmd_fail: {
    title: "Which command fails?",
    kind: "command",
    build: (q, name) => ({
      label: `${name} fails`,
      fault: { kind: "command_fails", match: q, once: true },
    }),
  },
  cmd_timeout: {
    title: "Which command times out?",
    kind: "command",
    build: (q, name) => ({
      label: `${name} times out`,
      fault: { kind: "command_timeout", match: q, once: true },
    }),
  },
};

function faultIcon(f: Fault) {
  switch (f.kind) {
    case "command_fails":
      return <Ban className="size-3.5 text-tone-danger" />;
    case "command_timeout":
      return <Clock className="size-3.5 text-tone-warn" />;
    case "freeze_param":
      return <Snowflake className="size-3.5 text-tone-info" />;
    case "drop_param":
      return <Unplug className="size-3.5 text-tone-neutral" />;
  }
}

function ItemPicker({
  mode,
  catalog,
  referenced,
  onClose,
  onPick,
}: {
  mode: PickerMode | null;
  catalog: Catalog | null;
  referenced: ReferencedItem[];
  onClose(): void;
  onPick(label: string, fault: Fault): void;
}) {
  const [query, setQuery] = useState("");
  const cfg = mode ? PICKER[mode] : null;
  const results = useMemo(() => {
    if (!catalog || !cfg || !query.trim()) return [];
    return searchCatalog(catalog, query, { kind: cfg.kind, limit: 30 });
  }, [catalog, cfg, query]);
  const refIds = new Set(referenced.map((r) => r.q));

  return (
    <CommandDialog
      open={mode !== null}
      onOpenChange={(o) => {
        if (!o) {
          setQuery("");
          onClose();
        }
      }}
      title={cfg?.title ?? "Pick"}
      description="Choose from what this procedure uses, or search the catalog."
      className="sm:max-w-md"
    >
      <Command shouldFilter={false}>
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder={`${cfg?.title ?? "Search"} Type to search the catalog…`}
        />
        <CommandList className="max-h-80">
          {!query.trim() && referenced.length > 0 && (
            <CommandGroup heading="Used in this procedure">
              {referenced.map((r) => (
                <CommandItem
                  key={r.q}
                  value={r.q}
                  onSelect={() => {
                    const { label, fault } = PICKER[mode!].build(r.q, r.name);
                    onPick(label, fault);
                    setQuery("");
                  }}
                >
                  <span className="truncate font-mono text-xs">{r.name}</span>
                  <span className="ml-auto truncate font-mono text-[10px] text-muted-foreground">
                    {r.q}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {!query.trim() && referenced.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              Nothing of this kind is referenced yet. Type to search the whole
              catalog.
            </p>
          )}
          {query.trim() && (
            <CommandGroup heading="Catalog">
              {results.map((r) => (
                <CommandItem
                  key={r.q}
                  value={r.q}
                  onSelect={() => {
                    const { label, fault } = PICKER[mode!].build(r.q, r.name);
                    onPick(label, fault);
                    setQuery("");
                  }}
                >
                  <span className="truncate font-mono text-xs">{r.name}</span>
                  {refIds.has(r.q) && (
                    <span className="rounded bg-primary/10 px-1 text-[10px] text-primary">
                      used
                    </span>
                  )}
                  <span className="ml-auto truncate font-mono text-[10px] text-muted-foreground">
                    {r.q}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {query.trim() && results.length === 0 && (
            <CommandEmpty>No match.</CommandEmpty>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

export function FaultsBuilder({
  faults,
  catalog,
  referencedParams,
  referencedCommands,
  onAdd,
  onRemove,
  onToggle,
}: {
  faults: FaultItem[];
  catalog: Catalog | null;
  referencedParams: ReferencedItem[];
  referencedCommands: ReferencedItem[];
  onAdd(label: string, fault: Fault): void;
  onRemove(id: string): void;
  onToggle(id: string): void;
}) {
  const [mode, setMode] = useState<PickerMode | null>(null);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
          <Zap className="size-3" /> Faults
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="xs">
              <Plus /> Inject
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel className="text-[11px]">
              Commands
            </DropdownMenuLabel>
            <DropdownMenuItem
              onSelect={() =>
                onAdd("Next command fails verification", {
                  kind: "command_fails",
                  match: "",
                  once: true,
                })
              }
            >
              <Ban className="text-tone-danger" /> Next command fails
              verification
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                onAdd("Next command times out", {
                  kind: "command_timeout",
                  match: "",
                  once: true,
                })
              }
            >
              <Clock className="text-tone-warn" /> Next command times out
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setMode("cmd_fail")}>
              <Ban className="text-tone-danger" /> A specific command fails…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setMode("cmd_timeout")}>
              <Clock className="text-tone-warn" /> A specific command times out…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[11px]">
              Telemetry
            </DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => setMode("freeze")}>
              <Snowflake className="text-tone-info" /> Freeze parameter…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setMode("drop")}>
              <Unplug className="text-tone-neutral" /> Drop parameter…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {faults.length === 0 ? (
        <p className="flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
          <TriangleAlert className="mt-px size-3 shrink-0" />
          Nothing injected. Add a fault to see how the procedure handles failed
          commands or missing telemetry; they can be toggled while it runs.
        </p>
      ) : (
        <ul className="space-y-1">
          {faults.map((f) => (
            <li
              key={f.id}
              className={cn(
                "group flex items-center gap-2 rounded-md border bg-card px-2 py-1.5 text-xs transition-opacity",
                !f.enabled && "opacity-55",
              )}
            >
              {faultIcon(f.fault)}
              <span className="min-w-0 flex-1 truncate" title={f.label}>
                {f.label}
              </span>
              {"once" in f.fault && f.fault.once && (
                <span className="rounded border px-1 text-[9px] text-muted-foreground">
                  once
                </span>
              )}
              <Switch
                size="sm"
                checked={f.enabled}
                onCheckedChange={() => onToggle(f.id)}
                aria-label={`${f.enabled ? "Disable" : "Enable"} ${f.label}`}
              />
              <button
                type="button"
                onClick={() => onRemove(f.id)}
                aria-label={`Remove ${f.label}`}
                className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100"
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {mode && (
        <ItemPicker
          mode={mode}
          catalog={catalog}
          referenced={
            mode && PICKER[mode].kind === "command"
              ? referencedCommands
              : referencedParams
          }
          onClose={() => setMode(null)}
          onPick={(label, fault) => {
            onAdd(label, fault);
            setMode(null);
          }}
        />
      )}
    </div>
  );
}
