/**
 * Small CLI over the Bifrost client. Never prints the token.
 *   npm run bifrost:sim -- list
 *   npm run bifrost:sim -- status <sim_id>
 *   npm run bifrost:sim -- start [seconds]   starts ONE short Real-time Jatayu SILS run (default 1800 s)
 *   npm run bifrost:sim -- stop <sim_id>
 */
import "./bifrost-env";
import { getSim, listSims, startShortSim, stopSim } from "../lib/bifrost/client";

const [cmd, arg] = process.argv.slice(2);
async function main() {
  if (cmd === "list") console.log(JSON.stringify(await listSims(), null, 2));
  else if (cmd === "status" && arg) console.log(JSON.stringify(await getSim(arg), null, 2));
  else if (cmd === "start") {
    const r = await startShortSim({ runName: "mos-prototype-short", simulationTimeSec: arg ? Number(arg) : 1800 });
    console.log(JSON.stringify(r));
  } else if (cmd === "stop" && arg) {
    await stopSim(arg);
    console.log("stop requested");
  } else {
    console.error("usage: list | status <id> | start [seconds] | stop <id>");
    process.exit(2);
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
