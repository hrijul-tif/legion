'use client';

/**
 * Run target "Bifrost (Jatayu SILS)": implements ProcedureRunApi over /api/bifrost/runs. The procedure executes on the
 * server with the real mos-framework against the attached simulation; events arrive over SSE in the same RunEvent
 * shapes the mock emits.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getRunClient, SandboxUnavailableError } from './run-client';
import { getAttachedSim, snapshotIdFromLocation } from './bifrost-selection';
import { MAX_EVENTS, type ProcedureRunApi, type ProcedureRunState } from './use-procedure-run';
import type { DoneEvent, Mission, RunEvent, RunRequest } from './types';

const FLUSH_MS = 100;
const EMPTY: ProcedureRunState = { status: 'idle', events: [], prompt: null, telemetry: {}, outcome: null, sandboxError: null, unavailable: false };

const failDone = (error: string): DoneEvent => ({ type: 'done', t: 0, wall: Date.now(), outcome: 'error', error, virtualSeconds: 0, wallMs: 0 });

interface PostResult {
  ok: boolean;
  status: number;
  json: Record<string, unknown>;
}

interface ActiveRun {
  runId: string | null;
  es: EventSource | null;
  promptId: string | null;
}

async function post(url: string, body: unknown): Promise<PostResult> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, json };
}

export function useBifrostRun(): ProcedureRunApi {
  const [state, setState] = useState<ProcedureRunState>(EMPTY);
  const buffer = useRef<RunEvent[]>([]);
  const telemetry = useRef<Record<string, unknown>>({});
  const telemetryDirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const active = useRef<ActiveRun | null>(null);

  const flush = useCallback(() => {
    timer.current = null;
    if (!mounted.current) return;
    const batch = buffer.current;
    const dirty = telemetryDirty.current;
    if (!batch.length && !dirty) return;
    buffer.current = [];
    telemetryDirty.current = false;
    const snapshot = dirty ? { ...telemetry.current } : null;
    setState((s) => {
      let events = s.events;
      if (batch.length) {
        events = s.events.concat(batch);
        if (events.length > MAX_EVENTS) events = events.slice(events.length - MAX_EVENTS);
      }
      return { ...s, events, telemetry: snapshot ?? s.telemetry };
    });
  }, []);
  const schedule = useCallback(() => {
    if (!timer.current) timer.current = setTimeout(flush, FLUSH_MS);
  }, [flush]);

  const stopRemote = useCallback((runId: string | null) => {
    if (runId) void fetch(`/api/bifrost/runs/${runId}/stop`, { method: 'POST', keepalive: true }).catch(() => undefined);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
      const a = active.current;
      if (a) {
        a.es?.close();
        stopRemote(a.runId); // leaving the page must not leave a procedure running on the simulation
      }
    };
  }, [stopRemote]);

  const onEvent = useCallback(
    (ev: RunEvent) => {
      if (!mounted.current) return;
      if (ev.type === 'tm') {
        telemetry.current[ev.q] = ev.value;
        telemetryDirty.current = true;
      }
      if (ev.type === 'telemetry') {
        Object.assign(telemetry.current, ev.values);
        telemetryDirty.current = true;
        schedule();
        return;
      }
      buffer.current.push(ev);
      if (ev.type === 'prompt') {
        flush();
        if (active.current) active.current.promptId = ev.id;
        setState((s) => ({ ...s, status: 'prompt', prompt: ev }));
      } else if (ev.type === 'done') {
        flush();
        setState((s) => ({ ...s, status: 'done', prompt: null, outcome: ev }));
      } else schedule();
    },
    [flush, schedule],
  );

  const run = useCallback(
    async (req: RunRequest): Promise<DoneEvent> => {
      if (active.current) throw new Error('A run is already in progress');
      const slot: ActiveRun = { runId: null, es: null, promptId: null };
      active.current = slot;
      buffer.current = [];
      telemetry.current = {};
      telemetryDirty.current = false;
      setState({ ...EMPTY, status: 'booting' });

      const abort = (message: string): DoneEvent => {
        const d = failDone(message);
        active.current = null;
        if (mounted.current) setState({ ...EMPTY, status: 'done', outcome: d, sandboxError: message });
        return d;
      };

      const simId = getAttachedSim();
      const snapshotId = snapshotIdFromLocation();
      if (!simId) return abort('Attach a Bifrost simulation first (pick one in the Bifrost panel, or start a short run).');
      if (!snapshotId) return abort('Cannot tell which snapshot is being run (expected a /snapshots/<id> page).');

      const res: PostResult = await post('/api/bifrost/runs', { snapshotId, simId, args: req.args, code: req.code, entrypoint: req.entrypoint ?? null }).catch(
        (e: unknown): PostResult => ({ ok: false, status: 0, json: { error: e instanceof Error ? e.message : String(e) } }),
      );
      if (!res.ok || typeof res.json.runId !== 'string') return abort(String(res.json.error ?? `Bifrost run request failed (${res.status})`));
      slot.runId = res.json.runId;
      if (mounted.current) setState((s) => ({ ...s, status: 'running' }));

      return new Promise<DoneEvent>((resolve) => {
        let finished = false;
        const finish = (d: DoneEvent) => {
          if (finished) return;
          finished = true;
          slot.es?.close();
          active.current = null;
          resolve(d);
        };
        const es = new EventSource(`/api/bifrost/runs/${slot.runId}/stream`);
        slot.es = es;
        let errors = 0;
        es.onmessage = (m: MessageEvent<string>) => {
          errors = 0;
          let ev: RunEvent;
          try {
            ev = JSON.parse(m.data) as RunEvent;
          } catch {
            return;
          }
          onEvent(ev);
          if (ev.type === 'done') finish(ev);
        };
        es.onerror = () => {
          // EventSource reconnects by itself (the server replays from Last-Event-ID); give up when it cannot
          if (es.readyState === EventSource.CLOSED || ++errors > 5) {
            const d = failDone('Lost the connection to the Bifrost run stream');
            onEvent(d);
            finish(d);
          }
        };
      });
    },
    [onEvent],
  );

  const stop = useCallback(async () => {
    const a = active.current;
    if (a?.runId) await fetch(`/api/bifrost/runs/${a.runId}/stop`, { method: 'POST' }).catch(() => undefined);
  }, []);

  const answer = useCallback((choice: string | number) => {
    const a = active.current;
    if (!a?.runId || !a.promptId) return;
    const id = a.promptId;
    a.promptId = null;
    void post(`/api/bifrost/runs/${a.runId}/input`, { id, choice });
    if (mounted.current) setState((s) => ({ ...s, status: s.status === 'prompt' ? 'running' : s.status, prompt: null }));
  }, []);

  // Not supported on this target (capabilities are false, the IDE hides the controls)
  const noop = useCallback(() => undefined, []);

  // argument forms are analysed in the browser with the JTYU catalog, exactly like for the mock
  const inspect = useCallback((code: string, mission: Mission = 'JTYU', entrypoint?: string) => getRunClient().inspect(code, mission, entrypoint), []);
  const warmUp = useCallback(async () => {
    try {
      await getRunClient().ensureReady();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (mounted.current) setState((s) => ({ ...s, sandboxError: message, unavailable: err instanceof SandboxUnavailableError }));
    }
  }, []);

  const reset = useCallback(() => {
    if (active.current) return;
    buffer.current = [];
    telemetry.current = {};
    setState(EMPTY);
  }, []);

  return { ...state, run, stop, answer, setTelemetry: noop, clearTelemetryOverrides: noop, setFaults: noop, setWarp: noop, inspect, warmUp, reset };
}
