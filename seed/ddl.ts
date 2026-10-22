/** What the migrations created, parsed from their `create ...` statements, and the SQL that removes it. */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface Objects {
  authTriggers: string[];
  views: string[];
  tables: string[];
  functions: { schema: string; name: string }[];
  schemas: string[];
  types: string[];
}

const ident = (s: string) => {
  if (!/^\w+$/.test(s)) throw new Error(`unexpected identifier ${s}`);
  return s;
};

export function parseMigrations(root: string): Objects {
  const dir = join(root, "supabase", "migrations");
  const text = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(dir, f), "utf8").replace(/--.*$/gm, ""))
    .join("\n");
  const o: Objects = { authTriggers: [], views: [], tables: [], functions: [], schemas: [], types: [] };
  for (const m of text.matchAll(/create\s+trigger\s+(\w+)[^;]*?\bon\s+auth\.users/gi)) o.authTriggers.push(ident(m[1]));
  for (const m of text.matchAll(/create\s+(?:or\s+replace\s+)?view\s+public\.(\w+)/gi)) o.views.push(ident(m[1]));
  for (const m of text.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.(\w+)/gi)) o.tables.push(ident(m[1]));
  for (const m of text.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(public|private)\.(\w+)/gi)) o.functions.push({ schema: m[1].toLowerCase(), name: ident(m[2]) });
  for (const m of text.matchAll(/create\s+schema\s+(?:if\s+not\s+exists\s+)?(\w+)/gi)) if (m[1] !== "public" && m[1] !== "extensions") o.schemas.push(ident(m[1]));
  for (const m of text.matchAll(/create\s+type\s+public\.(\w+)/gi)) o.types.push(ident(m[1]));
  return o;
}


/** Statements in dependency-safe order (run them in one transaction). */
export function dropStatements(o: Objects): string[] {
  const out: string[] = [];
  for (const t of o.authTriggers) out.push(`drop trigger if exists ${t} on auth.users`);
  for (const v of o.views) out.push(`drop view if exists public.${v} cascade`);
  // dropped tables also leave the realtime publication
  for (const t of o.tables) out.push(`drop table if exists public.${t} cascade`);
  out.push("drop table if exists public._mos_migrations");
  for (const f of new Set(o.functions.map((x) => `${x.schema}.${x.name}`))) {
    const [schema, name] = f.split(".");
    out.push(`do $$ declare r record; begin
      for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = '${schema}' and p.proname = '${name}' loop
        execute format('drop function %s cascade', r.sig);
      end loop;
    end $$`);
  }
  for (const s of o.schemas) out.push(`drop schema if exists ${s} cascade`);
  for (const t of o.types) out.push(`drop type if exists public.${t} cascade`);
  return out;
}
