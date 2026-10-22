import { createLoader } from "nuqs/server";
import { auditParsers } from "@/components/mos/tables/audit-params";
import { auditCsvHeader, auditCsvRow, fetchAuditAll } from "@/lib/data/audit";
import { createClient } from "@/lib/supabase/server";

const loadParams = createLoader(auditParsers);

/** CSV of the audit log for the filters in the query string (same keys as /audit). */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) {
    return Response.json({ error: "Sign in to export the audit log." }, { status: 401 });
  }

  const p = loadParams(new URL(request.url).searchParams);
  let result;
  try {
    result = await fetchAuditAll(supabase, { proc: p.proc, actor: p.actor, kind: p.kind, from: p.from, to: p.to, prod: p.prod });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Export failed" }, { status: 500 });
  }

  const lines = [auditCsvHeader(), ...result.entries.map(auditCsvRow)];
  const encoder = new TextEncoder();
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= lines.length) {
        controller.close();
        return;
      }
      const chunk = lines.slice(i, i + 500);
      i += chunk.length;
      controller.enqueue(encoder.encode(chunk.join("\r\n") + "\r\n"));
    },
  });

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="mos-audit-${stamp}.csv"`,
      "Cache-Control": "no-store",
      ...(result.truncated ? { "X-Export-Truncated": "true" } : {}),
    },
  });
}
