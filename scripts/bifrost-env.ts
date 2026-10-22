/** Shared helpers of the scripts/bifrost-*.ts commands: env loading and paths. Never prints the token. */
import { config } from "dotenv";
import { join, resolve } from "node:path";
import { spawnSync, type SpawnSyncOptions } from "node:child_process";

export const ROOT = resolve(__dirname, "..");
export const RUNNER = join(ROOT, "runner");
export const WORK = join(RUNNER, ".work");
export const FRAMEWORK_COPY = join(WORK, "mos-framework");

config({ path: join(ROOT, ".env.local"), quiet: true });

export function need(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name} in .env.local (see .env.example).`);
    process.exit(1);
  }
  return v;
}

export function sh(cmd: string, args: string[], opts: SpawnSyncOptions = {}): void {
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd: ROOT, ...opts });
  if (r.status !== 0) {
    console.error(`\n${cmd} ${args.join(" ")} failed (${r.status ?? r.signal})`);
    process.exit(r.status ?? 1);
  }
}

export function hasUv(): boolean {
  return spawnSync("uv", ["--version"], { stdio: "ignore" }).status === 0;
}
