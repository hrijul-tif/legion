/**
 * Removes everything the migrations created (clean-up after the prototype):
 * triggers on auth.users, views, tables, functions, the private schema, types, the procedure-code bucket with its
 * objects (through the Storage API) and the migration bookkeeping table. Dropped tables leave the realtime publication.
 *
 *   npm run db:drop -- --yes           drop it all
 *   npm run db:drop -- --yes --users   ...and delete the demo persona auth users
 *   npm run db:drop                    only lists what would be dropped
 *
 * What gets dropped is read from the `create ...` statements in supabase/migrations/*.sql, so it follows new migrations.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PERSONAS } from "../lib/personas";
import { dropStatements, parseMigrations } from "../seed/ddl";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: join(root, ".env.local"), quiet: true });

const confirmed = process.argv.includes("--yes");
const withUsers = process.argv.includes("--users");
const BUCKET = "procedure-code";

async function dropBucket() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    console.log(`  (skipped: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY to delete the ${BUCKET} bucket and the demo users)`);
    return null;
  }
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: buckets, error: be } = await db.storage.listBuckets();
  if (be) throw new Error(`list buckets: ${be.message}`);
  if (buckets.some((b) => b.id === BUCKET)) {
    const files: string[] = [];
    const stack = [""];
    while (stack.length) {
      const dir = stack.pop()!;
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await db.storage.from(BUCKET).list(dir, { limit: 1000, offset });
        if (error) throw new Error(`list ${dir}: ${error.message}`);
        if (!data?.length) break;
        for (const e of data) {
          const p = dir ? `${dir}/${e.name}` : e.name;
          if (e.id === null) stack.push(p);
          else files.push(p);
        }
        if (data.length < 1000) break;
      }
    }
    for (let i = 0; i < files.length; i += 100) {
      const { error } = await db.storage.from(BUCKET).remove(files.slice(i, i + 100));
      if (error) throw new Error(`remove objects: ${error.message}`);
    }
    const { error } = await db.storage.deleteBucket(BUCKET);
    if (error) throw new Error(`delete bucket: ${error.message}`);
    console.log(`  deleted bucket ${BUCKET} (${files.length} objects)`);
  } else console.log(`  bucket ${BUCKET} does not exist`);
  return db;
}

async function main() {
  const o = parseMigrations(root);
  console.log("This drops:");
  console.log(`  triggers on auth.users: ${o.authTriggers.join(", ") || "-"}`);
  console.log(`  views:     ${o.views.join(", ") || "-"}`);
  console.log(`  tables:    ${o.tables.join(", ") || "-"}, _mos_migrations`);
  console.log(`  functions: ${[...new Set(o.functions.map((f) => `${f.schema}.${f.name}`))].join(", ") || "-"}`);
  console.log(`  schemas:   ${o.schemas.join(", ") || "-"}`);
  console.log(`  types:     ${o.types.join(", ") || "-"}`);
  console.log(`  storage:   bucket ${BUCKET} and its objects`);
  if (withUsers) console.log(`  auth:      ${PERSONAS.length} demo users (${PERSONAS.map((p) => p.email).join(", ")})`);
  if (!confirmed) {
    console.error("\nNothing dropped. Re-run with --yes to confirm (and --users to delete the demo auth users too).");
    process.exit(1);
  }

  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    console.error("Missing SUPABASE_DB_URL in .env.local");
    process.exit(1);
  }

  console.log("\nStorage ...");
  const admin = await dropBucket();

  console.log("Database ...");
  const local = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
  const sql = postgres(url, { max: 1, ssl: local ? false : "require", onnotice: () => {}, connect_timeout: 20 });
  try {
    await sql.begin(async (tx) => {
      for (const stmt of dropStatements(o)) await tx.unsafe(stmt);
    });
    console.log("  dropped");
    await sql`select pg_notify('pgrst', 'reload schema')`;
  } finally {
    await sql.end({ timeout: 5 });
  }

  if (withUsers && admin) {
    console.log("Auth users ...");
    const wanted = new Set(PERSONAS.map((p) => p.email.toLowerCase()));
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error) throw new Error(`list users: ${error.message}`);
    let n = 0;
    for (const u of data.users) {
      if (u.email && wanted.has(u.email.toLowerCase())) {
        const { error: de } = await admin.auth.admin.deleteUser(u.id);
        if (de) throw new Error(`delete ${u.email}: ${de.message}`);
        n++;
      }
    }
    console.log(`  deleted ${n} users`);
  }
  console.log("\nDone. The extension citext was left in place (it may be shared).");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
