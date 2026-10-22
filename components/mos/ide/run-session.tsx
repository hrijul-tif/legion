"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { startRun, finishRun } from "@/app/actions/collab";
import type { Catalog } from "@/lib/catalog/types";
import { loadCatalog } from "@/lib/catalog/load";
import type { MosEntry } from "@/lib/editor/lang-protocol";
import type { DoneEvent, Fault, Mission, Outcome } from "@/lib/sandbox/types";
import type { ProcedureRunApi } from "@/lib/sandbox/use-procedure-run";
import {
  reconcile,
  specsFromEntry,
  specsFromSignature,
  toRunArgs,
  validate,
  type ArgSpec,
  type ArgValue,
  type ArgValues,
} from "@/lib/ide/args";
import { compactForStorage, summarize } from "@/lib/ide/console-model";
import { sha256Hex } from "@/lib/ide/hash";
import {
  referencedCommands,
  referencedParameters,
  type ReferencedItem,
} from "@/lib/ide/refs";
import {
  getRunTarget,
  listRunTargets,
  type RunTarget,
} from "@/lib/ide/run-targets";
import {
  IDE_KEYS,
  readJson,
  removeKey,
  writeJson,
  type IdePrefs,
} from "@/lib/ide/storage";
import { IDE_PREFS_DEFAULT_WARP } from "@/lib/ide/run-defaults";

export interface FaultItem {
  id: string;
  label: string;
  fault: Fault;
  enabled: boolean;
}

export type RunPersist = "idle" | "saving" | "saved" | "failed";

export interface LastRun {
  sha: string;
  outcome: Outcome;
  at: number;
}

export interface TargetOption {
  target: RunTarget;
  available: boolean;
  reason?: string;
}

export interface RunSession {
  mission: Mission;
  snapshotId: string;
  catalog: Catalog | null;
  run: ProcedureRunApi;
  target: RunTarget;
  targets: TargetOption[];
  setTargetId(id: RunTarget["id"]): void;

  specs: ArgSpec[];
  values: ArgValues;
  setValue(name: string, v: ArgValue): void;
  errors: Record<string, string>;
  showErrors: boolean;
  /** the form shows the last good signature because the file does not parse right now */
  signatureStale: boolean;

  warp: number;
  setWarp(w: number): void;
  faults: FaultItem[];
  addFault(label: string, fault: Fault): void;
  removeFault(id: string): void;
  toggleFault(id: string): void;

  start(): Promise<void>;
  stop(): void;
  busy: boolean;
  canRun: boolean;
  disabledReason: string | null;

  answers: Record<string, string>;
  answer(choice: string): void;

  persist: RunPersist;
  lastRun: LastRun | null;

  referencedParams: ReferencedItem[];
  referencedCommands: ReferencedItem[];
  pinned: string[];
  pin(q: string): void;
  unpin(q: string): void;
  /** values set from the inspector (also before a run starts) */
  edits: Record<string, unknown>;
  editTelemetry(q: string, value: unknown): void;
  simInitial: Record<string, unknown>;
}

const Ctx = createContext<RunSession | null>(null);

export function useRunSession(): RunSession {
  const v = useContext(Ctx);
  if (!v)
    throw new Error("useRunSession must be used inside <RunSessionProvider>");
  return v;
}

export interface RunSessionProviderProps {
  snapshotId: string;
  mission: Mission;
  bifrostEnabled: boolean;
  /** exact text to run (read when Run is pressed) */
  getCode(): string;
  /** debounced text for analysis (referenced parameters, signature) */
  code: string;
  /** signature from the editor's language service; undefined => analyse `code` with the run worker instead */
  entry?: MosEntry | null;
  children: ReactNode;
}

export function RunSessionProvider(props: RunSessionProviderProps) {
  const [targetId, setTargetId] = useState<RunTarget["id"]>("mock");
  return (
    <SessionInner
      key={targetId}
      {...props}
      target={getRunTarget(targetId)}
      setTargetId={setTargetId}
    >
      {props.children}
    </SessionInner>
  );
}

interface Pending {
  sha: string;
  args: Record<string, unknown>;
  options: Record<string, unknown>;
  started: Promise<string | null> | null;
}

let faultSeq = 0;

function SessionInner({
  target,
  setTargetId,
  snapshotId,
  mission,
  bifrostEnabled,
  getCode,
  code,
  entry,
  children,
}: RunSessionProviderProps & {
  target: RunTarget;
  setTargetId(id: RunTarget["id"]): void;
}) {
  const run = target.useRun();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [inspected, setInspected] = useState<ArgSpec[] | null>(null);
  const [lastGood, setLastGood] = useState<ArgSpec[]>([]);
  const [values, setValues] = useState<ArgValues>({});
  const [seenKey, setSeenKey] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [warp, setWarpState] = useState<number>(() => {
    const p = readJson<IdePrefs>(IDE_KEYS.prefs);
    return p?.warp === "inf"
      ? Infinity
      : typeof p?.warp === "number"
        ? p.warp
        : IDE_PREFS_DEFAULT_WARP;
  });
  const [faults, setFaults] = useState<FaultItem[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [persist, setPersist] = useState<RunPersist>("idle");
  const [lastRun, setLastRun] = useState<LastRun | null>(() =>
    readJson<LastRun>(IDE_KEYS.lastRun(snapshotId)),
  );
  const [pinned, setPinned] = useState<string[]>(
    () => readJson<string[]>(IDE_KEYS.pinned(snapshotId)) ?? [],
  );
  const [edits, setEdits] = useState<Record<string, unknown>>({});
  const [simInitial, setSimInitial] = useState<Record<string, unknown>>({});
  const pending = useRef<Pending | null>(null);

  /* ------------------------------------------------------------ catalog + sim */
  useEffect(() => {
    let cancelled = false;
    loadCatalog(mission)
      .then((c) => !cancelled && setCatalog(c))
      .catch(() => undefined);
    fetch(`/sim/${mission.toLowerCase()}-sim.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (j: { initial?: Record<string, unknown> } | null) =>
          !cancelled && j?.initial && setSimInitial(j.initial),
      )
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [mission]);

  /* --------------------------------------------------------------- signature */
  const inspectFn = run.inspect;
  useEffect(() => {
    if (entry !== undefined) return;
    let cancelled = false;
    inspectFn(code, mission)
      .then(
        (sig) =>
          !cancelled && !sig.error && setInspected(specsFromSignature(sig)),
      )
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [entry, code, mission, inspectFn]);

  const parsed = useMemo<ArgSpec[] | null>(
    () =>
      entry === undefined
        ? inspected
        : entry
          ? specsFromEntry(entry, catalog)
          : null,
    [entry, catalog, inspected],
  );
  if (parsed && parsed !== lastGood) setLastGood(parsed);
  const specs = parsed ?? lastGood;
  const signatureStale = !parsed && lastGood.length > 0;

  const specsKey = specs
    .map(
      (s) =>
        `${s.name}:${s.kind}:${s.enumName ?? ""}:${s.members?.length ?? 0}`,
    )
    .join("|");
  if (specsKey !== seenKey) {
    setSeenKey(specsKey);
    setValues((prev) =>
      reconcile(specs, readJson<ArgValues>(IDE_KEYS.args(snapshotId)), prev),
    );
  }
  useEffect(() => {
    if (specsKey) writeJson(IDE_KEYS.args(snapshotId), values);
  }, [values, specsKey, snapshotId]);

  const errors = useMemo(() => validate(specs, values), [specs, values]);
  const setValue = useCallback(
    (name: string, v: ArgValue) =>
      setValues((prev) => ({ ...prev, [name]: v })),
    [],
  );

  /* ------------------------------------------------------------------ prefs */
  const setWarp = useCallback(
    (w: number) => {
      setWarpState(w);
      const prefs = readJson<IdePrefs>(IDE_KEYS.prefs) ?? {};
      writeJson(IDE_KEYS.prefs, {
        ...prefs,
        warp: Number.isFinite(w) ? w : "inf",
      } satisfies IdePrefs);
      run.setWarp(w);
    },
    [run],
  );

  /* ----------------------------------------------------------------- faults */
  const addFault = useCallback(
    (label: string, fault: Fault) =>
      setFaults((f) => [
        ...f,
        { id: `f${++faultSeq}`, label, fault, enabled: true },
      ]),
    [],
  );
  const removeFault = useCallback(
    (id: string) => setFaults((f) => f.filter((x) => x.id !== id)),
    [],
  );
  const toggleFault = useCallback(
    (id: string) =>
      setFaults((f) =>
        f.map((x) => (x.id === id ? { ...x, enabled: !x.enabled } : x)),
      ),
    [],
  );
  const effectiveFaults = useMemo(
    () => faults.filter((f) => f.enabled).map((f) => f.fault),
    [faults],
  );
  const live = run.status === "running" || run.status === "prompt";
  const faultsKey = JSON.stringify(effectiveFaults);
  const setFaultsLive = run.setFaults;
  useEffect(() => {
    if (live) setFaultsLive(effectiveFaults);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the serialised key is the change signal
  }, [faultsKey, live, setFaultsLive]);

  /* -------------------------------------------------------------- telemetry */
  const editTelemetry = useCallback(
    (q: string, value: unknown) => {
      setEdits((e) => ({ ...e, [q]: value }));
      run.setTelemetry(q, value);
    },
    [run],
  );
  const pin = useCallback(
    (q: string) =>
      setPinned((p) => {
        if (p.includes(q)) return p;
        const next = [...p, q];
        writeJson(IDE_KEYS.pinned(snapshotId), next);
        return next;
      }),
    [snapshotId],
  );
  const unpin = useCallback(
    (q: string) =>
      setPinned((p) => {
        const next = p.filter((x) => x !== q);
        if (next.length) writeJson(IDE_KEYS.pinned(snapshotId), next);
        else removeKey(IDE_KEYS.pinned(snapshotId));
        return next;
      }),
    [snapshotId],
  );

  const referencedParams = useMemo(
    () => (catalog ? referencedParameters(code, catalog) : []),
    [code, catalog],
  );
  const referencedCmds = useMemo(
    () => (catalog ? referencedCommands(code, catalog) : []),
    [code, catalog],
  );

  /* --------------------------------------------------------------- running */
  const busy =
    run.status === "booting" ||
    run.status === "running" ||
    run.status === "prompt";
  const blank = code.trim() === "";
  const disabledReason = blank ? "The file is empty" : null;

  const start = useCallback(async () => {
    if (busy) return;
    if (Object.keys(errors).length) {
      setShowErrors(true);
      toast.error("Fix the highlighted arguments first");
      return;
    }
    const source = getCode();
    if (!source.trim()) return;
    const sha = await sha256Hex(source);
    const args = toRunArgs(specs, values);
    const faultList = faults.filter((f) => f.enabled).map((f) => f.fault);
    const wire = {
      warp: Number.isFinite(warp) ? warp : "inf",
      faults: faultList,
      entrypoint: entry?.entrypoint ?? null,
    };
    pending.current = { sha, args, options: wire, started: null };
    setPersist("idle");
    setAnswers({});
    setShowErrors(false);
    run
      .run({
        code: source,
        entrypoint: entry?.entrypoint ?? undefined,
        args,
        mission,
        options: { warp, faults: faultList },
      })
      .catch((e: unknown) =>
        toast.error(e instanceof Error ? e.message : String(e)),
      );
  }, [busy, errors, getCode, specs, values, faults, warp, entry, run, mission]);

  const stop = useCallback(() => void run.stop(), [run]);

  const answer = useCallback(
    (choice: string) => {
      const p = run.prompt;
      if (!p) return;
      setAnswers((a) => ({ ...a, [p.id]: choice }));
      run.answer(choice);
    },
    [run],
  );

  const ensureStarted = useCallback(
    (p: Pending): Promise<string | null> => {
      if (!p.started) {
        setPersist("saving");
        p.started = startRun({
          snapshot_id: snapshotId,
          target: target.recordedAs,
          code_sha256: p.sha,
          args: p.args,
          options: p.options,
        }).then(
          (res) => (res.ok ? res.data.id : null),
          () => null,
        );
      }
      return p.started;
    },
    [snapshotId, target.recordedAs],
  );

  // record the run in history as soon as it really starts (not for a sandbox that could not boot)
  useEffect(() => {
    const p = pending.current;
    if (p && run.status === "running") void ensureStarted(p);
  }, [run.status, ensureStarted]);

  // ... and complete the record when it ends
  const { status, outcome, events, sandboxError } = run;
  useEffect(() => {
    const p = pending.current;
    if (!p || status !== "done" || !outcome) return;
    pending.current = null;
    const done: DoneEvent = outcome;
    const entryLast: LastRun = {
      sha: p.sha,
      outcome: done.outcome,
      at: Date.now(),
    };
    setLastRun(entryLast);
    writeJson(IDE_KEYS.lastRun(snapshotId), entryLast);
    if (sandboxError && !p.started) {
      setPersist("idle");
      return;
    }
    void (async () => {
      const runId = await ensureStarted(p);
      if (!runId) {
        setPersist("failed");
        return;
      }
      const res = await finishRun(runId, {
        outcome: done.outcome,
        error: done.error ?? null,
        events: compactForStorage(events),
        summary: summarize(events, done),
      }).catch(() => ({ ok: false as const, error: "network" }));
      setPersist(res.ok ? "saved" : "failed");
    })();
  }, [status, outcome, events, sandboxError, snapshotId, ensureStarted]);

  /* ---------------------------------------------------------------- targets */
  const targets = useMemo<TargetOption[]>(
    () =>
      listRunTargets().map((t) => {
        const a = t.availability({ mission, bifrostEnabled });
        return {
          target: t,
          available: a.available,
          reason: a.available ? undefined : a.reason,
        };
      }),
    [mission, bifrostEnabled],
  );

  const value: RunSession = {
    mission,
    snapshotId,
    catalog,
    run,
    target,
    targets,
    setTargetId,
    specs,
    values,
    setValue,
    errors,
    showErrors,
    signatureStale,
    warp,
    setWarp,
    faults,
    addFault,
    removeFault,
    toggleFault,
    start,
    stop,
    busy,
    canRun: !busy && !disabledReason,
    disabledReason,
    answers,
    answer,
    persist,
    lastRun,
    referencedParams,
    referencedCommands: referencedCmds,
    pinned,
    pin,
    unpin,
    edits,
    editTelemetry,
    simInitial,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
