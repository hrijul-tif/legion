import { cn } from "@/lib/utils";
import { STATE_META, type SnapshotState, type Tone } from "@/lib/lifecycle";

export const TONE_CLASSES: Record<Tone, { text: string; bg: string; border: string; dot: string }> = {
  neutral: { text: "text-tone-neutral", bg: "bg-tone-neutral/10", border: "border-tone-neutral/25", dot: "bg-tone-neutral" },
  info: { text: "text-tone-info", bg: "bg-tone-info/10", border: "border-tone-info/25", dot: "bg-tone-info" },
  progress: { text: "text-tone-progress", bg: "bg-tone-progress/10", border: "border-tone-progress/25", dot: "bg-tone-progress" },
  warn: { text: "text-tone-warn", bg: "bg-tone-warn/10", border: "border-tone-warn/25", dot: "bg-tone-warn" },
  success: { text: "text-tone-success", bg: "bg-tone-success/10", border: "border-tone-success/30", dot: "bg-tone-success" },
  danger: { text: "text-tone-danger", bg: "bg-tone-danger/10", border: "border-tone-danger/25", dot: "bg-tone-danger" },
  muted: { text: "text-tone-muted", bg: "bg-tone-muted/10", border: "border-tone-muted/20", dot: "bg-tone-muted" },
};

export function StateBadge({
  state,
  size = "sm",
  short = false,
  showCode = true,
  className,
}: {
  state: SnapshotState;
  size?: "xs" | "sm" | "md";
  short?: boolean;
  showCode?: boolean;
  className?: string;
}) {
  const meta = STATE_META[state];
  const tone = TONE_CLASSES[meta.tone];
  const live = state === "approved" || state === "test_in_progress";
  return (
    <span
      title={`${meta.code} · ${meta.label} — ${meta.description}`}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border font-medium whitespace-nowrap",
        tone.text,
        tone.bg,
        tone.border,
        size === "xs" && "h-5 px-1.5 text-[11px]",
        size === "sm" && "h-6 px-2 text-xs",
        size === "md" && "h-7 px-2.5 text-sm",
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", tone.dot, live && "animate-pulse-ring", tone.text)} />
      {showCode && <span className="font-mono opacity-70">{meta.code}</span>}
      {short ? meta.short : meta.label}
    </span>
  );
}

export function ToneDot({ tone, className }: { tone: Tone; className?: string }) {
  return <span className={cn("inline-block size-2 rounded-full", TONE_CLASSES[tone].dot, className)} />;
}
