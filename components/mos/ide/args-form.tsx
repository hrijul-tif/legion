"use client";

import {
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { utcLocalInput, type ArgSpec, type ArgValue } from "@/lib/ide/args";

interface FieldProps {
  spec: ArgSpec;
  value: ArgValue | undefined;
  error?: string;
  disabled?: boolean;
  onChange(v: ArgValue): void;
}

const inputCls = "h-8 font-mono text-xs md:text-xs";

function ChipsInput({ spec, value, error, disabled, onChange }: FieldProps) {
  const items = Array.isArray(value) ? value : [];
  const [draft, setDraft] = useState("");
  const ref = useRef<HTMLInputElement>(null);

  const commit = (raw: string) => {
    const parts = raw
      .split(/[,\n]/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length) onChange([...items, ...parts]);
    setDraft("");
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit(draft);
    } else if (e.key === "Backspace" && !draft && items.length)
      onChange(items.slice(0, -1));
  };
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (/[,\n]/.test(text)) {
      e.preventDefault();
      commit(text);
    }
  };

  return (
    <div
      onClick={() => ref.current?.focus()}
      aria-invalid={!!error}
      className={cn(
        "flex min-h-8 w-full flex-wrap items-center gap-1 rounded-lg border border-input bg-transparent px-1.5 py-1 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30",
        error && "border-destructive",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      {items.map((item, i) => (
        <span
          key={`${item}-${i}`}
          className="inline-flex items-center gap-0.5 rounded-md border bg-muted px-1.5 py-0.5 font-mono text-[11px]"
        >
          {item}
          <button
            type="button"
            aria-label={`Remove ${item}`}
            className="rounded-sm text-muted-foreground hover:text-foreground"
            onClick={() => onChange(items.filter((_, j) => j !== i))}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        ref={ref}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
        onPaste={onPaste}
        onBlur={() => draft.trim() && commit(draft)}
        placeholder={
          items.length
            ? ""
            : spec.itemKind === "int" || spec.itemKind === "float"
              ? "type a number, press Enter"
              : "type a value, press Enter"
        }
        className="min-w-16 flex-1 bg-transparent px-1 font-mono text-xs outline-none placeholder:text-muted-foreground"
        aria-label={`${spec.name} items`}
      />
    </div>
  );
}

const NOW_SHORTCUTS = [
  { label: "now", minutes: 0 },
  { label: "+5 min", minutes: 5 },
  { label: "+30 min", minutes: 30 },
  { label: "+1 h", minutes: 60 },
];

function DatetimeField({ value, error, disabled, onChange }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <Input
        type="datetime-local"
        step={60}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={!!error}
        disabled={disabled}
        className={inputCls}
      />
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-0.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
          UTC
        </span>
        {NOW_SHORTCUTS.map((s) => (
          <Button
            key={s.label}
            type="button"
            variant="outline"
            size="xs"
            disabled={disabled}
            onClick={() => onChange(utcLocalInput(new Date(), s.minutes))}
            className="h-5 px-1.5 text-[10px]"
          >
            {s.minutes === 0 ? "now" : `now ${s.label}`}
          </Button>
        ))}
      </div>
    </div>
  );
}

function EnumField({ spec, value, error, disabled, onChange }: FieldProps) {
  const members = spec.members ?? [];
  if (!members.length) {
    return (
      <Input
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={
          spec.enumName ? `${spec.enumName} member name` : "member name"
        }
        aria-invalid={!!error}
        disabled={disabled}
        className={inputCls}
      />
    );
  }
  return (
    <Select
      value={typeof value === "string" && value ? value : undefined}
      onValueChange={(v) => onChange(v)}
      disabled={disabled}
    >
      <SelectTrigger
        size="sm"
        aria-invalid={!!error}
        className="h-8 w-full font-mono text-xs"
      >
        <SelectValue placeholder="Choose…" />
      </SelectTrigger>
      <SelectContent position="popper" className="max-h-72">
        {members.map((m) => (
          <SelectItem
            key={m.name}
            value={m.name}
            title={m.name}
            className="font-mono text-xs"
          >
            {typeof m.value === "string" ? m.value : m.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function ArgField(props: FieldProps) {
  const { spec, value, error, disabled, onChange } = props;
  switch (spec.kind) {
    case "bool":
      return (
        <label className="flex h-8 items-center gap-2 text-xs">
          <Switch
            size="sm"
            checked={value === true}
            onCheckedChange={(c) => onChange(c)}
            disabled={disabled}
          />
          <span className="font-mono text-muted-foreground">
            {value === true ? "True" : "False"}
          </span>
        </label>
      );
    case "enum":
      return <EnumField {...props} />;
    case "list":
      return <ChipsInput {...props} />;
    case "datetime":
      return <DatetimeField {...props} />;
    case "int":
    case "float":
      return (
        <Input
          inputMode={spec.kind === "int" ? "numeric" : "decimal"}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={spec.kind === "int" ? "0" : "0.0"}
          aria-invalid={!!error}
          disabled={disabled}
          className={cn(inputCls, "tabular")}
        />
      );
    default:
      return (
        <Input
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={!!error}
          disabled={disabled}
          className={inputCls}
          spellCheck={false}
        />
      );
  }
}

export function ArgsForm({
  specs,
  values,
  errors,
  showErrors,
  disabled,
  onChange,
}: {
  specs: ArgSpec[];
  values: Record<string, ArgValue>;
  errors: Record<string, string>;
  showErrors: boolean;
  disabled?: boolean;
  onChange(name: string, v: ArgValue): void;
}) {
  if (!specs.length) {
    return (
      <p className="rounded-lg border border-dashed px-3 py-3 text-center text-xs text-muted-foreground">
        The entry function takes no arguments.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {specs.map((spec) => {
        const err = errors[spec.name];
        return (
          <div key={spec.name} className="space-y-1">
            <label className="flex items-baseline justify-between gap-2">
              <span className="truncate font-mono text-[11px] font-medium">
                {spec.name}
                {spec.required && (
                  <span className="ml-0.5 text-tone-danger">*</span>
                )}
              </span>
              <span
                className="truncate font-mono text-[10px] text-muted-foreground"
                title={spec.annotation ?? undefined}
              >
                {spec.enumName ?? spec.annotation ?? spec.kind}
              </span>
            </label>
            <ArgField
              spec={spec}
              value={values[spec.name]}
              error={showErrors || values[spec.name] !== "" ? err : undefined}
              disabled={disabled}
              onChange={(v) => onChange(spec.name, v)}
            />
            {err &&
              (showErrors ||
                (values[spec.name] !== "" &&
                  values[spec.name] !== undefined)) && (
                <p className="text-[11px] text-tone-danger">{err}</p>
              )}
          </div>
        );
      })}
    </div>
  );
}
