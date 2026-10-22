/**
 * Server-side REST client for Bifrost (docs/API.md of the bifrost repo). Reads the token from the environment on every
 * call and never exposes it; import it from route handlers and scripts only.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FailureCommand, OverrideManifest, SimListItem, SimStatus } from "./types";

if (typeof window !== "undefined") throw new Error("lib/bifrost/client must not be imported in the browser");

export interface BifrostConfig {
  baseUrl: string;
  workspace: string;
  token: string;
}

export function bifrostConfig(): BifrostConfig {
  const baseUrl = (process.env.BIFROST_BASE_URL ?? "").replace(/\/+$/, "");
  const workspace = process.env.BIFROST_WORKSPACE ?? "";
  const token = process.env.BIFROST_API_TOKEN ?? "";
  if (!baseUrl || !workspace || !token) throw new BifrostError(500, "BIFROST_BASE_URL, BIFROST_WORKSPACE and BIFROST_API_TOKEN must be set");
  return { baseUrl, workspace, token };
}

export class BifrostError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
    this.name = "BifrostError";
  }
}

/** YAMCS session name of a run: `<workspace>-<sim_id>` with the ISO time written as YYYY-MM-DD-HH-MM-SS. */
export function sessionOf(workspace: string, simId: string): string {
  return `${workspace}-${simId.replace(/[T:]/g, "-").replace(/Z$/, "")}`;
}

/** Address handed to yamcs-client / the runner: the host plus the per-run path, no scheme. */
export function yamcsAddress(baseUrl: string, workspace: string, simId: string): string {
  return `${baseUrl.replace(/^https?:\/\//, "")}/yamcs/${sessionOf(workspace, simId)}`;
}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown, opts: { timeoutMs?: number; allow?: number[] } = {}): Promise<T | null> {
  const cfg = bifrostConfig();
  const res = await fetch(`${cfg.baseUrl}/api/v1/workspaces/${encodeURIComponent(cfg.workspace)}${path}`, {
    method,
    headers: { Authorization: `Bearer ${cfg.token}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
    cache: "no-store",
  }).catch((e: unknown) => {
    throw new BifrostError(502, `Cannot reach Bifrost at ${cfg.baseUrl} (VPN?): ${e instanceof Error ? e.message : String(e)}`);
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (opts.allow?.includes(res.status)) return null;
  if (!res.ok) {
    const msg = typeof parsed === "object" && parsed && "message" in parsed ? String((parsed as { message: unknown }).message) : typeof parsed === "string" && parsed ? parsed : res.statusText;
    throw new BifrostError(res.status, `Bifrost ${method} ${path} -> ${res.status}: ${msg}`, parsed);
  }
  return parsed as T;
}

const sim = (simId: string) => `/simulations/${encodeURIComponent(simId)}`;

export async function listSims(): Promise<SimListItem[]> {
  const r = await call<{ simulations?: SimListItem[] }>("GET", "/simulations");
  return r?.simulations ?? [];
}

export async function getSim(simId: string): Promise<SimStatus> {
  const cfg = bifrostConfig();
  const [life, progress] = await Promise.all([
    call<Omit<SimStatus, "progress" | "yamcs" | "session">>("GET", sim(simId)),
    // progress is unauthenticated and answers 404/410 once the run is over
    call<{ percent: number; elapsed: number }>("GET", `${sim(simId)}/progress`, undefined, { allow: [404, 410] }).catch(() => null),
  ]);
  if (!life) throw new BifrostError(404, "Simulation not found");
  return { ...life, progress: progress ? { percent: progress.percent, elapsed: progress.elapsed } : null, session: sessionOf(cfg.workspace, simId), yamcs: yamcsAddress(cfg.baseUrl, cfg.workspace, simId) };
}

export interface StartOptions {
  runName: string;
  /** simulationTime in seconds (default 1800) */
  simulationTimeSec?: number;
  fswTag?: string;
}

/** A short Real-time Jatayu SILS run: the shipped sample sim_config with the duration replaced. */
export async function startShortSim(opts: StartOptions): Promise<{ sim_time_iso: string }> {
  const yaml = (await readFile(join(process.cwd(), "lib/bifrost/sim-config.short.yml"), "utf8"))
    .replace(/^simulationTime:.*$/m, `simulationTime: ${(opts.simulationTimeSec ?? 1800).toFixed(1)} s`)
    .replace(/^simulationSpeed:.*$/m, "simulationSpeed: Real-time");
  const fsw = opts.fswTag ?? yaml.match(/^fswVersion:\s*(\S+)/m)?.[1] ?? "jtyu-v15.0.3";
  const r = await call<{ sim_time_iso: string }>("POST", "/simulations", {
    image_tag_fsw: fsw,
    compatibility_fsw_version: fsw,
    simulation_type: "SILS",
    mode: "full",
    run_name: opts.runName,
    sim_config: yaml,
  });
  if (!r?.sim_time_iso) throw new BifrostError(502, "Bifrost accepted the run but returned no sim_time_iso");
  return r;
}

export async function stopSim(simId: string): Promise<void> {
  await call("POST", `${sim(simId)}/stop`, undefined, { allow: [] });
}

export async function overrideManifest(simId: string): Promise<OverrideManifest> {
  const r = await call<OverrideManifest>("GET", `${sim(simId)}/override-manifest`, undefined, { timeoutMs: 60_000 });
  if (!r) throw new BifrostError(502, "Empty override manifest");
  return r;
}

export async function injectFailures(simId: string, failures: FailureCommand | FailureCommand[]): Promise<unknown> {
  return call("POST", `${sim(simId)}/failures`, { failures_config: failures });
}

/** Reads one flight-software parameter from this run's YAMCS through Bifrost's passthrough. */
export async function readFswParam(simId: string, parameterName: string): Promise<unknown> {
  const cfg = bifrostConfig();
  const mcs = encodeURIComponent(`${cfg.baseUrl}/yamcs/${sessionOf(cfg.workspace, simId)}`);
  return call("POST", `${sim(simId)}/mcs/${mcs}/params`, { parameter_name: parameterName, get_from: "last" });
}

/** Direct, unauthenticated YAMCS REST (the per-run YAMCS has no auth). */
export async function yamcsGet<T>(simId: string, path: string): Promise<T> {
  const cfg = bifrostConfig();
  const res = await fetch(`${cfg.baseUrl}/yamcs/${sessionOf(cfg.workspace, simId)}/api${path}`, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new BifrostError(res.status, `YAMCS GET ${path} -> ${res.status}`);
  return (await res.json()) as T;
}
