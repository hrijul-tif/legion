import type { RunTarget } from "@/lib/ide/run-targets";
import { useBifrostRun } from "@/lib/sandbox/bifrost-run";
import { BifrostPanel } from "./bifrost-panel";

/** The real "Bifrost (Jatayu SILS)" run target: server-side runner against an attached Bifrost simulation. */
export const BIFROST_TARGET: RunTarget = {
  id: "bifrost",
  label: "Bifrost (Jatayu SILS)",
  hint: "Runs on the server with the real mos-framework against a live Bifrost simulation (Jatayu, real time)",
  recordedAs: "bifrost",
  capabilities: { warp: false, faults: false, inspector: false },
  availability: (ctx) => {
    if (ctx.mission !== "JTYU") return { available: false, reason: "Bifrost simulates the Jatayu (JTYU) mission only" };
    if (!ctx.bifrostEnabled) return { available: false, reason: "Bifrost is not enabled for this deployment" };
    return { available: true };
  },
  useRun: useBifrostRun,
  Panel: BifrostPanel,
};
