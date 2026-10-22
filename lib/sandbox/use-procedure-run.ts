'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getRunClient, SandboxUnavailableError } from './run-client';
import type { DoneEvent, Fault, Mission, PromptEvent, RunEvent, RunRequest, SignatureResult } from './types';

export const MAX_EVENTS = 5000;
const FLUSH_MS = 100;

export type RunStatus = 'idle' | 'booting' | 'running' | 'prompt' | 'done';

export interface ProcedureRunState {
  status: RunStatus;
  /**
   * Events of the current/last run (log, stdout, command, tm, prompt, done), oldest first, capped at MAX_EVENTS
   * (oldest dropped). `telemetry` events are not stored here; see `telemetry`.
   */
  events: RunEvent[];
  /** Prompt waiting for the operator, if any. */
  prompt: PromptEvent | null;
  /** Latest telemetry snapshot (qualified name -> value) of the current/last run. */
  telemetry: Record<string, unknown>;
  /** `done` event of the last finished run (also synthesised when the sandbox could not start). */
  outcome: DoneEvent | null;
  /** Set when the sandbox itself is unavailable (e.g. not cross-origin isolated); `unavailable` tells which kind. */
  sandboxError: string | null;
  unavailable: boolean;
}

export interface ProcedureRunApi extends ProcedureRunState {
  /** Starts a run. Resolves with the outcome when it finishes. */
  run(req: RunRequest): Promise<DoneEvent>;
  /** Stops the running procedure. */
  stop(): Promise<void>;
  /** Answers the pending prompt with one of its choice strings (or its index). */
  answer(choice: string | number): void;
  /** Overrides a telemetry value from the inspector (live during a run; remembered for later runs). */
  setTelemetry(q: string, value: unknown): void;
  clearTelemetryOverrides(): void;
  /** Replaces the active faults (live during a run). */
  setFaults(faults: Fault[]): void;
  setWarp(warp: number): void;
  /** Analyses a procedure without running it (args form). Rejects with Error('busy') while running. */
  inspect(code: string, mission?: Mission, entrypoint?: string): Promise<SignatureResult>;
  /** Boots the sandbox ahead of the first run (status 'booting' meanwhile). */
  warmUp(): Promise<void>;
  /** Back to idle: clears events, prompt, outcome and telemetry. No-op while running. */
  reset(): void;
}

const EMPTY: ProcedureRunState = {
  status: 'idle',
  events: [],
  prompt: null,
  telemetry: {},
  outcome: null,
  sandboxError: null,
  unavailable: false,
};

export function useProcedureRun(): ProcedureRunApi {
  const [state, setState] = useState<ProcedureRunState>(EMPTY);
  const buffer = useRef<RunEvent[]>([]);
  const telemetryRef = useRef<Record<string, unknown> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const activeRef = useRef(false);

  const flush = useCallback(() => {
    timer.current = null;
    if (!mounted.current) return;
    const batch = buffer.current;
    const telemetry = telemetryRef.current;
    if (!batch.length && !telemetry) return;
    buffer.current = [];
    telemetryRef.current = null;
    setState((s) => {
      let events = s.events;
      if (batch.length) {
        events = s.events.concat(batch);
        if (events.length > MAX_EVENTS) events = events.slice(events.length - MAX_EVENTS);
      }
      return { ...s, events, telemetry: telemetry ?? s.telemetry };
    });
  }, []);

  const schedule = useCallback(() => {
    if (!timer.current) timer.current = setTimeout(flush, FLUSH_MS);
  }, [flush]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
      // leaving the page must not leave a procedure running
      if (activeRef.current) void getRunClient().stop();
    };
  }, []);

  const onEvent = useCallback(
    (ev: RunEvent) => {
      if (!mounted.current) return;
      if (ev.type === 'telemetry') {
        telemetryRef.current = ev.values;
        schedule();
        return;
      }
      buffer.current.push(ev);
      if (ev.type === 'prompt') {
        flush();
        setState((s) => ({ ...s, status: 'prompt', prompt: ev }));
      } else if (ev.type === 'done') {
        flush();
        activeRef.current = false;
        setState((s) => ({ ...s, status: 'done', prompt: null, outcome: ev }));
      } else {
        schedule();
      }
    },
    [flush, schedule],
  );

  const run = useCallback(
    async (req: RunRequest): Promise<DoneEvent> => {
      const client = getRunClient();
      if (activeRef.current || client.running) throw new Error('A run is already in progress');
      activeRef.current = true;
      buffer.current = [];
      telemetryRef.current = null;
      setState({ ...EMPTY, status: 'booting' });
      try {
        await client.ensureReady();
      } catch (err) {
        activeRef.current = false;
        const message = err instanceof Error ? err.message : String(err);
        const outcome: DoneEvent = { type: 'done', t: 0, wall: Date.now(), outcome: 'error', error: message, virtualSeconds: 0, wallMs: 0 };
        if (mounted.current) {
          setState({ ...EMPTY, status: 'done', outcome, sandboxError: message, unavailable: err instanceof SandboxUnavailableError });
        }
        return outcome;
      }
      if (mounted.current) setState((s) => ({ ...s, status: 'running' }));
      try {
        return await client.run(req, onEvent);
      } finally {
        activeRef.current = false;
      }
    },
    [onEvent],
  );

  const stop = useCallback(() => getRunClient().stop(), []);

  const answer = useCallback((choice: string | number) => {
    const client = getRunClient();
    const p = client.currentPrompt;
    if (!p) return;
    client.answerPrompt(p.id, choice);
    if (mounted.current) setState((s) => ({ ...s, status: s.status === 'prompt' ? 'running' : s.status, prompt: null }));
  }, []);

  const setTelemetry = useCallback((q: string, value: unknown) => getRunClient().setTelemetry(q, value), []);
  const clearTelemetryOverrides = useCallback(() => getRunClient().clearTelemetryOverrides(), []);
  const setFaults = useCallback((faults: Fault[]) => getRunClient().setFaults(faults), []);
  const setWarp = useCallback((warp: number) => getRunClient().setWarp(warp), []);
  const inspect = useCallback((code: string, mission: Mission = 'FF', entrypoint?: string) => getRunClient().inspect(code, mission, entrypoint), []);

  const warmUp = useCallback(async () => {
    if (activeRef.current) return;
    setState((s) => (s.status === 'idle' ? { ...s, status: 'booting' } : s));
    try {
      await getRunClient().ensureReady();
      if (mounted.current) setState((s) => (s.status === 'booting' && !activeRef.current ? { ...s, status: 'idle' } : s));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (mounted.current) {
        setState((s) => ({ ...s, status: s.status === 'booting' ? 'idle' : s.status, sandboxError: message, unavailable: err instanceof SandboxUnavailableError }));
      }
    }
  }, []);

  const reset = useCallback(() => {
    if (activeRef.current) return;
    buffer.current = [];
    telemetryRef.current = null;
    setState(EMPTY);
  }, []);

  return { ...state, run, stop, answer, setTelemetry, clearTelemetryOverrides, setFaults, setWarp, inspect, warmUp, reset };
}
