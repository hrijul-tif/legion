"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Play, RefreshCw, Square, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { setAttachedSim, useAttachedSim } from "@/lib/sandbox/bifrost-selection";
import type { OverrideManifest } from "@/lib/bifrost/types";
import { injectFault, loadManifest, useBifrostSims, type SimRow } from "./use-bifrost-sims";

const CHIP: Record<string, string> = {
  RUNNING: "bg-tone-success/15 text-tone-success",
  INITIALIZING: "bg-tone-warn/15 text-tone-warn",
  STOPPING: "bg-tone-warn/15 text-tone-warn",
  FAILED: "bg-tone-danger/15 text-tone-danger",
  COMPLETED: "bg-muted text-muted-foreground",
  STOPPED: "bg-muted text-muted-foreground",
};

const label = (s: SimRow) => s.run_name || s.simulation_id.replace("T", " ").replace("Z", "");

function SimRowView({ sim, attached, onAttach, onStop }: { sim: SimRow; attached: boolean; onAttach(): void; onStop(): void }) {
  const live = sim.state === "RUNNING";
  const busy = sim.state === "INITIALIZING" || sim.state === "STOPPING";
  return (
    <li className={cn("rounded-md border bg-card/60 p-2 text-xs", attached && "border-primary/60 ring-1 ring-primary/30")}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium" title={sim.simulation_id}>
            {label(sim)}
          </div>
          <div className="truncate font-mono text-[10px] text-muted-foreground">{sim.simulation_id}</div>
        </div>
        <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold", CHIP[sim.state] ?? CHIP.STOPPED)}>
          {busy && <Loader2 className="size-3 animate-spin" />}
          {sim.state}
          {sim.state === "INITIALIZING" && sim.phase ? ` · ${sim.phase}` : ""}
        </span>
      </div>
      {sim.progress && live && (
        <div className="mt-1.5 h-1 overflow-hidden rounded bg-muted" title={`${Math.round(sim.progress.elapsed)} s elapsed`}>
          <div className="h-full bg-primary" style={{ width: `${Math.min(100, sim.progress.percent)}%` }} />
        </div>
      )}
      {sim.state === "INITIALIZING" && sim.components && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {Object.entries(sim.components).map(([k, c]) => (
            <span key={k} className={cn("rounded px-1 font-mono text-[10px]", c.state === "RUNNING" || c.state === "READY" ? "text-tone-success" : c.state === "FAILED" ? "text-tone-danger" : "text-muted-foreground")}>
              {k}:{c.state.toLowerCase()}
            </span>
          ))}
        </div>
      )}
      {sim.error && <p className="mt-1 text-[11px] text-tone-danger">{sim.error.message}</p>}
      <div className="mt-2 flex items-center gap-1.5">
        {live && (
          <Button size="xs" variant={attached ? "secondary" : "default"} onClick={onAttach}>
            {attached ? "Attached (detach)" : "Attach"}
          </Button>
        )}
        {(live || sim.state === "INITIALIZING") && (
          <Button size="xs" variant="outline" onClick={onStop}>
            <Square className="size-3" /> Stop
          </Button>
        )}
      </div>
    </li>
  );
}

function FaultInjector({ simId }: { simId: string }) {
  const [manifest, setManifest] = useState<OverrideManifest | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [target, setTarget] = useState("");
  const [field, setField] = useState("");
  const [value, setValue] = useState("0");
  const [duration, setDuration] = useState("60");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadManifest(simId).then(
      (m) => !cancelled && setManifest(m),
      (e: unknown) => !cancelled && setErr(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [simId]);

  // outputs are what the flight software reads; those are the useful faults
  const targets = useMemo(() => (manifest ? Object.entries(manifest.targets).filter(([, t]) => t.kind === "output").map(([k]) => k) : []), [manifest]);
  const fields = manifest?.targets[target]?.fields ?? [];
  const spec = fields.find((f) => f.path === field);

  const send = async (failures: unknown, what: string) => {
    setBusy(true);
    try {
      const r = await injectFault(simId, failures);
      toast.success(`${what}: ${r.message ?? "accepted"}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const inject = () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      toast.error("The value must be JSON (a number, true/false, a string or an array)");
      return;
    }
    void send(
      { type: "messageOverride", target, mode: "replace", value: { [field]: parsed }, ...(Number(duration) > 0 ? { durationSec: Number(duration) } : {}) },
      `${target} ${field}=${value}`,
    );
  };

  if (err) return <p className="text-[11px] text-tone-danger">{err}</p>;
  if (!manifest) return <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Loader2 className="size-3 animate-spin" /> Loading override manifest…</p>;
  const select = "h-7 w-full rounded-md border bg-background px-1.5 text-xs";
  return (
    <div className="space-y-1.5">
      <select className={select} value={target} onChange={(e) => { setTarget(e.target.value); setField(""); }} aria-label="Fault target">
        <option value="">Target (simulated device output)…</option>
        {targets.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>
      <select className={select} value={field} disabled={!target} onChange={(e) => { setField(e.target.value); const d = fields.find((f) => f.path === e.target.value)?.default; setValue(d === undefined ? "0" : JSON.stringify(d)); }} aria-label="Fault field">
        <option value="">Field…</option>
        {fields.map((f) => (
          <option key={f.path} value={f.path}>{f.path} ({f.kind})</option>
        ))}
      </select>
      <div className="flex gap-1.5">
        <input className={cn(select, "font-mono")} value={value} onChange={(e) => setValue(e.target.value)} placeholder="value (JSON)" aria-label="Override value" />
        <input className={cn(select, "w-20 shrink-0 font-mono")} value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="sec" aria-label="Duration in simulated seconds" title="Duration in simulated seconds (0 = rest of the run)" />
      </div>
      {spec?.default !== undefined && <p className="text-[10px] text-muted-foreground">nominal {JSON.stringify(spec.default)}</p>}
      <div className="flex gap-1.5">
        <Button size="xs" disabled={busy || !target || !field} onClick={inject}>
          <Zap className="size-3" /> Inject
        </Button>
        <Button size="xs" variant="outline" disabled={busy} onClick={() => void send({ type: "clearAllMessageOverrides" }, "Cleared all overrides")}>
          Clear all
        </Button>
      </div>
    </div>
  );
}

/** Mounted inside the IDE's Run panel when the Bifrost target is selected. */
export function BifrostPanel() {
  const { sims, workspace, runnerReady, loading, error, refresh, start, stop } = useBifrostSims();
  const attached = useAttachedSim();
  const [confirmStart, setConfirmStart] = useState(false);
  const [confirmStop, setConfirmStop] = useState<SimRow | null>(null);
  const [starting, setStarting] = useState(false);
  const attachedSim = sims.find((s) => s.simulation_id === attached);

  // attached sim ended: drop the selection so Run does not target a dead simulation
  useEffect(() => {
    if (attachedSim && !["RUNNING", "INITIALIZING"].includes(attachedSim.state)) setAttachedSim(null);
  }, [attachedSim]);

  const doStart = async () => {
    setStarting(true);
    try {
      const id = await start();
      setAttachedSim(id);
      toast.success("Simulation starting. It becomes attachable when RUNNING.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
      setConfirmStart(false);
    }
  };

  return (
    <div className="space-y-2.5 rounded-lg border bg-muted/20 p-2.5" aria-label="Bifrost simulation">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Bifrost simulation{workspace ? ` · ${workspace}` : ""}</span>
        <Button size="icon-xs" variant="ghost" onClick={() => void refresh()} aria-label="Refresh simulations">
          <RefreshCw className={cn("size-3", loading && "animate-spin")} />
        </Button>
      </div>
      {!runnerReady && <p className="text-[11px] text-tone-warn">The Python runner is not installed. Run `npm run bifrost:setup` on the server.</p>}
      {error && <p className="text-[11px] text-tone-danger">{error}</p>}
      {!attached && !loading && !error && <p className="text-[11px] text-muted-foreground">Attach to a RUNNING simulation, or start a short run (30 min, real time).</p>}
      <ul className="space-y-1.5">
        {sims.slice(0, 6).map((s) => (
          <SimRowView
            key={s.simulation_id}
            sim={s}
            attached={s.simulation_id === attached}
            onAttach={() => setAttachedSim(s.simulation_id === attached ? null : s.simulation_id)}
            onStop={() => setConfirmStop(s)}
          />
        ))}
      </ul>
      {!loading && !error && sims.length === 0 && <p className="text-[11px] text-muted-foreground">No simulations in this workspace.</p>}
      <Button size="xs" variant="outline" className="w-full" disabled={starting} onClick={() => setConfirmStart(true)}>
        {starting ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />} Start a short run (30 min)
      </Button>

      {attachedSim?.state === "RUNNING" && (
        <details className="group rounded-md border bg-card/60 p-2">
          <summary className="cursor-pointer text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Fault injection</summary>
          <div className="mt-2">
            <FaultInjector key={attachedSim.simulation_id} simId={attachedSim.simulation_id} />
          </div>
        </details>
      )}

      <AlertDialog open={confirmStart} onOpenChange={setConfirmStart}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start a Bifrost simulation?</AlertDialogTitle>
            <AlertDialogDescription>
              This starts one Jatayu SILS run in workspace {workspace ?? "(configured)"} on the shared Bifrost service. It runs in real time for 30 minutes and uses cluster resources until it ends or you stop it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); void doStart(); }}>Start simulation</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!confirmStop} onOpenChange={(o) => !o && setConfirmStop(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop this simulation?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmStop ? `${label(confirmStop)} (${confirmStop.simulation_id}) will be stopped for everyone using it. Any procedure running on it will fail.` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep running</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const s = confirmStop;
                setConfirmStop(null);
                if (s) stop(s.simulation_id).then(() => toast.success("Stop requested"), (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)));
              }}
            >
              Stop simulation
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
