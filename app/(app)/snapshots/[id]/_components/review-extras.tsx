"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, AlertTriangle, ClipboardCheck, Info, Loader2, ScanSearch } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { SectionCard } from "./bits";

/* ------------------------------------------------------------------ checklist */

const ITEMS = [
  { id: "tc", label: "Telecommands verified against the MDB", hint: "Names, argument types and enum values exist in the catalog." },
  { id: "timeouts", label: "Timeouts are sensible", hint: "Waits on telemetry have bounds that match the real spacecraft." },
  { id: "prompts", label: "Failure handling covers operator prompts", hint: "Every failed command or check leads somewhere defined." },
  { id: "paths", label: "No hard-coded paths or secrets", hint: "File paths, URLs, tokens, instance names." },
  { id: "safe", label: "Aborting leaves a safe state", hint: "Nothing is left half-commanded if the run stops here." },
  { id: "args", label: "Entry-point arguments and defaults are safe", hint: "Defaults won’t surprise an operator who accepts them." },
];

/** A gentle aid for reviewers. Ticks live only in this browser tab; nothing is saved or enforced. */
export function ReviewerChecklist() {
  const [done, setDone] = useState<Record<string, boolean>>({});
  const n = ITEMS.filter((i) => done[i.id]).length;
  return (
    <SectionCard
      title="Reviewer checklist"
      icon={<ClipboardCheck />}
      actions={
        <span className="tabular text-xs text-muted-foreground">
          {n}/{ITEMS.length}
        </span>
      }
      bodyClassName="space-y-1 p-2"
    >
      <div className="mx-2 mb-2 h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className="h-full rounded-full bg-tone-success transition-[width] duration-300" style={{ width: `${(n / ITEMS.length) * 100}%` }} />
      </div>
      {ITEMS.map((i) => (
        <label key={i.id} className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/50">
          <Checkbox className="mt-0.5" checked={!!done[i.id]} onCheckedChange={(v) => setDone((d) => ({ ...d, [i.id]: v === true }))} />
          <span className="min-w-0">
            <span className={cn("block text-[13px]", done[i.id] && "text-muted-foreground line-through decoration-muted-foreground/40")}>{i.label}</span>
            <span className="block text-[11.5px] text-muted-foreground">{i.hint}</span>
          </span>
        </label>
      ))}
      <p className="px-2 pt-1 text-[11px] text-muted-foreground">Just a prompt for your own review — ticks aren’t saved and don’t gate anything.</p>
    </SectionCard>
  );
}

/* ----------------------------------------------------------- static analysis */

type Severity = "error" | "warning" | "info";
interface Finding {
  source: "Ruff" | "MOS" | "Catalog";
  code: string;
  severity: Severity;
  message: string;
  line: number;
  col: number;
}

function ruffSeverity(code: string): Severity {
  if (code === "invalid-syntax" || code.startsWith("E9") || /^F(821|822|823|63\d|70\d|50\d|60\d)/.test(code)) return "error";
  if (code.startsWith("W") || code.startsWith("UP")) return "info";
  return "warning";
}

type Phase = "idle" | "running" | "done" | "unavailable";

/**
 * Re-runs Ruff, the MOS checks and the catalog checks in the browser against the frozen code.
 * If the language worker is unavailable the card disappears: this is a reviewer's aid, not a gate.
 */
export function StaticAnalysis({ code, mission, onJump }: { code: string; mission: "FF" | "JTYU"; onJump: (line: number) => void }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [findings, setFindings] = useState<Finding[]>([]);

  useEffect(() => {
    if (!code.trim()) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPhase("running");
    (async () => {
      const out: Finding[] = [];
      let ok = 0;
      try {
        const { getLangClient } = await import("@/lib/editor/lang-client");
        const client = getLangClient();
        const [ruff, mos] = await Promise.allSettled([client.check(code), client.mosCheck(code, mission)]);
        if (ruff.status === "fulfilled" && ruff.value) {
          ok++;
          for (const d of ruff.value) out.push({ source: "Ruff", code: d.code, severity: ruffSeverity(d.code), message: d.message, line: d.startLine, col: d.startColumn });
        }
        if (mos.status === "fulfilled" && mos.value) {
          ok++;
          for (const d of mos.value.diagnostics) out.push({ source: "MOS", code: d.code, severity: d.severity, message: d.message, line: d.startLine, col: d.startColumn });
        }
      } catch {
        /* worker failed to start: fall through to the catalog checks */
      }
      try {
        const [{ loadCatalog }, { validateSource }] = await Promise.all([import("@/lib/catalog/load"), import("@/lib/editor/catalog-analysis")]);
        const catalog = await loadCatalog(mission);
        ok++;
        for (const d of validateSource(code, catalog))
          out.push({ source: "Catalog", code: d.code, severity: d.severity, message: d.message, line: d.startLineNumber, col: d.startColumn });
      } catch {
        /* catalog unavailable */
      }
      if (cancelled) return;
      out.sort((a, b) => a.line - b.line || a.col - b.col);
      setFindings(out);
      setPhase(ok === 0 ? "unavailable" : "done");
    })();
    return () => {
      cancelled = true;
    };
  }, [code, mission]);

  const counts = useMemo(
    () => ({
      error: findings.filter((f) => f.severity === "error").length,
      warning: findings.filter((f) => f.severity === "warning").length,
      info: findings.filter((f) => f.severity === "info").length,
    }),
    [findings],
  );

  if (phase === "unavailable" || phase === "idle") return null;

  return (
    <SectionCard
      title="Static analysis"
      icon={<ScanSearch />}
      actions={
        phase === "running" ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" /> Running Ruff + MOS checks…
          </span>
        ) : (
          <span className="flex items-center gap-2 text-xs tabular">
            {counts.error > 0 && <span className="text-tone-danger">{counts.error} error{counts.error === 1 ? "" : "s"}</span>}
            {counts.warning > 0 && <span className="text-tone-warn">{counts.warning} warning{counts.warning === 1 ? "" : "s"}</span>}
            {counts.info > 0 && <span className="text-muted-foreground">{counts.info} note{counts.info === 1 ? "" : "s"}</span>}
            {findings.length === 0 && <span className="text-tone-success">No findings</span>}
          </span>
        )
      }
      bodyClassName="p-0"
    >
      {phase === "running" ? (
        <div className="space-y-2 p-4">
          <div className="h-3.5 w-3/4 animate-pulse rounded bg-muted" />
          <div className="h-3.5 w-1/2 animate-pulse rounded bg-muted" />
        </div>
      ) : findings.length === 0 ? (
        <p className="p-4 text-[13px] text-muted-foreground">Ruff, the MOS rules and the TM/TC catalog check found nothing to flag in this snapshot.</p>
      ) : (
        <ul className="max-h-72 divide-y overflow-y-auto">
          {findings.map((f, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => onJump(f.line)}
                className="flex w-full items-start gap-2.5 px-4 py-2 text-left outline-none hover:bg-muted/50 focus-visible:bg-muted/60"
              >
                {f.severity === "error" ? (
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-tone-danger" />
                ) : f.severity === "warning" ? (
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-tone-warn" />
                ) : (
                  <Info className="mt-0.5 size-3.5 shrink-0 text-tone-info" />
                )}
                <span className="min-w-0 flex-1 text-[13px] leading-snug">
                  {f.message}
                  <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                    {f.source} {f.code}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular">
                  {f.line}:{f.col}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
