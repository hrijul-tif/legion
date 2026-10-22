/**
 * Applies supabase/migrations/*.sql in order to SUPABASE_DB_URL (Dashboard -> Connect -> Session pooler).
 * One transaction per file; applied files are tracked in public._mos_migrations.
 *
 *   npm run db:setup              apply what is missing
 *   npm run db:setup -- --status  list applied / pending files, change nothing
 *
 * If the core tables already exist but the tracking table does not (the migration was applied some other way, e.g.
 * through the Supabase MCP), the existing files are recorded as applied instead of being run again.
 */
import { config } from "dotenv";
import postgres from "postgres";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: join(root, ".env.local"), quiet: true });

const statusOnly = process.argv.includes("--status");

async function main() {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    console.error("Missing SUPABASE_DB_URL in .env.local (Dashboard -> Connect -> Session pooler connection string, with your database password).");
    process.exit(1);
  }
  const dir = join(root, "supabase", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  if (!files.length) {
    console.error(`No migrations found in ${dir}`);
    process.exit(1);
  }

  const local = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
  const sql = postgres(url, { max: 1, ssl: local ? false : "require", onnotice: () => {}, connect_timeout: 20 });
  try {
    const [{ tracking, core }] = await sql<{ tracking: string | null; core: string | null }[]>`
      select to_regclass('public._mos_migrations')::text as tracking, to_regclass('public.procedures')::text as core`;

    if (!tracking) {
      if (statusOnly) {
        console.log(core ? "Core tables exist but migrations are not tracked yet; a normal run would record all files as applied." : "Fresh database: nothing applied yet.");
        files.forEach((f) => console.log(`  pending  ${f}`));
        return;
      }
      await sql.unsafe(`
        create table public._mos_migrations (name text primary key, applied_at timestamptz not null default now());
        alter table public._mos_migrations enable row level security;
        revoke all on public._mos_migrations from anon, authenticated;
        comment on table public._mos_migrations is 'Bookkeeping of scripts/db-setup.ts; no policies, service/db role only.';
      `);
      if (core) {
        console.log("Core tables already exist; recording the migration files as applied (not running them).");
        for (const f of files) await sql`insert into public._mos_migrations (name) values (${f}) on conflict do nothing`;
      }
    }

    const applied = new Set((await sql<{ name: string }[]>`select name from public._mos_migrations`).map((r) => r.name));
    const pending = files.filter((f) => !applied.has(f));
    if (statusOnly) {
      files.forEach((f) => console.log(`  ${applied.has(f) ? "applied " : "pending "} ${f}`));
      return;
    }
    if (!pending.length) {
      console.log("Database is up to date.");
      return;
    }
    for (const f of pending) {
      process.stdout.write(`Applying ${f} ... `);
      const text = readFileSync(join(dir, f), "utf8");
      await sql.begin(async (tx) => {
        await tx.unsafe(text);
        await tx`insert into public._mos_migrations (name) values (${f})`;
      });
      console.log("done");
    }
    await sql`select pg_notify('pgrst', 'reload schema')`;
    console.log(`Applied ${pending.length} migration${pending.length === 1 ? "" : "s"}. Next: npm run db:seed`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
