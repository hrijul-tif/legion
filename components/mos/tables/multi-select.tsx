"use client";

import { useState } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface MultiSelectOption {
  value: string;
  label: string;
  hint?: string;
  leading?: React.ReactNode;
  group?: string;
}

/** Searchable multi-select (Popover + Command). Used for procedure, author, actor and kind filters. */
export function MultiSelect({
  label,
  icon,
  options,
  selected,
  onChange,
  searchPlaceholder = "Search…",
  emptyText = "No matches.",
  single = false,
  className,
}: {
  label: string;
  icon?: React.ReactNode;
  options: MultiSelectOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  searchPlaceholder?: string;
  emptyText?: string;
  /** Pick at most one option; selecting closes the popover. */
  single?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const active = selected.length > 0;
  const first = options.find((o) => o.value === selected[0]);
  const toggle = (v: string) => {
    if (single) {
      onChange(selected.includes(v) ? [] : [v]);
      setOpen(false);
    } else onChange(selected.includes(v) ? selected.filter((s) => s !== v) : [...selected, v]);
  };
  const groups = [...new Set(options.map((o) => o.group ?? ""))];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          aria-label={label}
          className={cn("h-8 max-w-56 justify-between gap-1.5 font-normal", active && "border-primary/40 bg-primary/5", className)}
        >
          {icon}
          <span className="truncate">
            {active ? (selected.length === 1 && first ? first.label : `${label} · ${selected.length}`) : label}
          </span>
          <ChevronsUpDown className="size-3 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 gap-0 p-0">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            {groups.map((g, gi) => (
              <CommandGroup key={g || "_"} heading={g || undefined}>
                {options
                  .filter((o) => (o.group ?? "") === g)
                  .map((o) => (
                    <CommandItem key={o.value} value={`${o.label} ${o.hint ?? ""} ${o.value}`} data-checked={selected.includes(o.value)} onSelect={() => toggle(o.value)}>
                      <span className={cn("grid size-4 shrink-0 place-items-center rounded border", selected.includes(o.value) ? "border-primary bg-primary text-primary-foreground" : "border-input")}>
                        {selected.includes(o.value) && <Check className="size-3" />}
                      </span>
                      {o.leading}
                      <span className="min-w-0 flex-1 truncate">{o.label}</span>
                      {o.hint && <span className="shrink-0 truncate font-mono text-[11px] text-muted-foreground">{o.hint}</span>}
                    </CommandItem>
                  ))}
                {gi < groups.length - 1 && <CommandSeparator />}
              </CommandGroup>
            ))}
          </CommandList>
          {active && (
            <div className="border-t p-1">
              <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground" onClick={() => onChange([])}>
                <X /> Clear {selected.length} selected
              </Button>
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
