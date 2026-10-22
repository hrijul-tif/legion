/** Dev helper: run ad-hoc SQL against SUPABASE_DB_URL.  npx tsx scripts/sql.ts "select 1" ["select 2" ...] */
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local", quiet: true });
const sql = postgres(process.env.SUPABASE_DB_URL!, { ssl: "require", max: 1, onnotice: () => {} });

async function main() {
  for (const q of process.argv.slice(2)) console.log(JSON.stringify(await sql.unsafe(q)));
}
main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
