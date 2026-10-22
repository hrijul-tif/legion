/**
 * npm run bifrost:gen-mdb [-- --sim <sim_id>]
 *
 * Generates the Jatayu TM/TC library from a RUNNING Bifrost simulation's YAMCS MDB into the runner's WORK COPY of
 * mos-framework (framework/jtyu/{command_schemas,parameter_schemas,commands.py,parameters.py}), then rebuilds
 * public/catalog/jtyu.json (the browser IDE's catalog) from it. Without --sim the newest RUNNING sim is used.
 * The mos-framework repository itself is never modified.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FRAMEWORK_COPY, ROOT, RUNNER, need, sh } from "./bifrost-env";
import { bifrostConfig, getSim, listSims, yamcsAddress } from "../lib/bifrost/client";

async function main() {
  const py = join(RUNNER, ".venv/bin/python");
  if (!existsSync(py) || !existsSync(join(FRAMEWORK_COPY, "framework"))) {
    console.error("Runner not set up. Run `npm run bifrost:setup` first.");
    process.exit(1);
  }
  need("BIFROST_API_TOKEN");
  const arg = process.argv.indexOf("--sim");
  let simId = arg > 0 ? process.argv[arg + 1] : "";
  if (!simId) {
    const running = (await listSims()).filter((s) => s.status === "RUNNING" || s.status === "PROGRESS");
    const live: string[] = [];
    for (const s of running) if ((await getSim(s.sim_id)).state === "RUNNING") live.push(s.sim_id);
    if (!live.length) {
      console.error("No RUNNING Bifrost simulation in this workspace. Start one (or pass --sim <id>).");
      process.exit(1);
    }
    simId = live.sort().at(-1)!;
  }
  const cfg = bifrostConfig();
  const address = yamcsAddress(cfg.baseUrl, cfg.workspace, simId);
  console.log(`-> generating from sim ${simId}\n   YAMCS http://${address}`);
  sh(py, ["-m", "mos_runner.genmdb", FRAMEWORK_COPY, address], { cwd: RUNNER });
  console.log("-> building public/catalog/jtyu.json");
  const out = join(ROOT, "public/catalog/jtyu.json");
  sh("python3", ["scripts/build_catalog.py", "--mission", "jtyu", "--framework", FRAMEWORK_COPY, "--out", out]);
  // the copy has no .git, so build_catalog would report this repo's commit; name the real sources instead
  let sha = "unknown";
  try {
    sha = execFileSync("git", ["-C", need("MOS_FRAMEWORK_PATH"), "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  } catch {}
  const cat = JSON.parse(readFileSync(out, "utf8")) as { source: string };
  cat.source = `mos-framework @ ${sha} generators, Bifrost SILS MDB (session ${cfg.workspace}, instance jtyu) generated ${new Date().toISOString().slice(0, 10)}`;
  writeFileSync(out, JSON.stringify(cat));
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
