import { Archive, CheckCircle2, Hourglass, Layers } from "lucide-react";
import { TONE_CLASSES } from "@/components/mos/state-badge";
import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/lifecycle";
import type { ProcedureStats } from "@/lib/data/procedures";

const TILES: { key: keyof ProcedureStats; label: string; sub: string; tone: Tone; icon: React.ReactNode }[] = [
  { key: "total", label: "Procedures", sub: "not retired", tone: "neutral", icon: <Layers /> },
  { key: "activeInProd", label: "Active in PROD", sub: "have an approved snapshot", tone: "success", icon: <CheckCircle2 /> },
  { key: "pending", label: "Pending work", sub: "in review, test or approval", tone: "warn", icon: <Hourglass /> },
  { key: "retired", label: "Retired", sub: "blocked from use", tone: "muted", icon: <Archive /> },
];

export function ProcedureSummary({ stats }: { stats: ProcedureStats }) {
  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {TILES.map((t) => (
        <div key={t.key} className="flex items-center gap-3 rounded-xl border bg-card/40 px-4 py-3">
          <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg border [&_svg]:size-4", TONE_CLASSES[t.tone].text, TONE_CLASSES[t.tone].bg, TONE_CLASSES[t.tone].border)}>{t.icon}</span>
          <div className="min-w-0">
            <dd className="tabular text-xl leading-6 font-semibold">{stats[t.key]}</dd>
            <dt className="truncate text-xs text-muted-foreground">
              {t.label} <span className="hidden opacity-70 sm:inline">· {t.sub}</span>
            </dt>
          </div>
        </div>
      ))}
    </dl>
  );
}

export function ProcedureSummarySkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-[62px] animate-pulse rounded-xl border bg-card/40" />
      ))}
    </div>
  );
}
