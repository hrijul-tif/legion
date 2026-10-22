"use client";

import { useState } from "react";
import { Keyboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Kbd, Tip, useModLabel } from "./ui";

export function ShortcutsPopover({
  open: controlled,
  onOpenChange,
}: {
  open?: boolean;
  onOpenChange?(o: boolean): void;
}) {
  const mod = useModLabel();
  const [local, setLocal] = useState(false);
  const open = controlled ?? local;
  const setOpen = onOpenChange ?? setLocal;

  const rows: { keys: string[]; label: string }[] = [
    { keys: [mod, "↵"], label: "Run the procedure" },
    { keys: [mod, "."], label: "Stop the run" },
    { keys: [mod, "S"], label: "Format and save now" },
    { keys: ["⇧", "⌥", "F"], label: "Format document" },
    { keys: [mod, "B"], label: "Show / hide the side panel" },
    { keys: [mod, "⇧", "L"], label: "Show / hide the run panel" },
    { keys: ["Ctrl", "`"], label: "Show / hide the console" },
    { keys: [mod, "Space"], label: "Suggestions" },
    {
      keys: ["1", "–", "9"],
      label: "Answer a prompt (when no field has focus)",
    },
    { keys: ["?"], label: "This list" },
  ];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tip label="Keyboard shortcuts" keys={["?"]}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Keyboard shortcuts"
            className="text-muted-foreground"
          >
            <Keyboard />
          </Button>
        </PopoverTrigger>
      </Tip>
      <PopoverContent align="end" className="w-80 gap-1 p-3">
        <p className="mb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
          Keyboard shortcuts
        </p>
        {rows.map((r) => (
          <div
            key={r.label}
            className="flex items-center justify-between gap-3 py-0.5 text-xs"
          >
            <span>{r.label}</span>
            <span className="flex shrink-0 gap-0.5">
              {r.keys.map((k, i) => (
                <Kbd key={`${k}${i}`}>{k}</Kbd>
              ))}
            </span>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}
