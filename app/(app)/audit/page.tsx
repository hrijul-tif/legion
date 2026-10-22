import type { Metadata } from "next";
import { Suspense } from "react";
import { createLoader } from "nuqs/server";
import { PageBody, PageHeader } from "@/components/mos/page-header";
import { auditParsers } from "@/components/mos/tables/audit-params";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchAuditPage, fetchProcedures, fetchProfiles, lookupIncident } from "@/lib/data/audit";
import { createClient } from "@/lib/supabase/server";
import { AuditPager } from "./_components/audit-pager";
import { AuditRows } from "./_components/audit-rows";
import { AuditShell } from "./_components/audit-shell";
import { IncidentResultView } from "./_components/incident-result";

export const metadata: Metadata = { title: "Audit log" };

const loadParams = createLoader(auditParsers);

export default function AuditPage({ searchParams }: PageProps<"/audit">) {
  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every state change and procedure event, newest first. Append-only: nobody, admins included, can edit or delete a row."
      />
      <PageBody>
        <Suspense fallback={<AuditSkeleton />}>
          <Audit searchParams={searchParams} />
        </Suspense>
      </PageBody>
    </>
  );
}

async function Audit({ searchParams }: { searchParams: PageProps<"/audit">["searchParams"] }) {
  const p = await loadParams(searchParams);
  const supabase = await createClient();
  const [procedures, profiles, log, incident] = await Promise.all([
    fetchProcedures(supabase),
    fetchProfiles(supabase),
    fetchAuditPage(supabase, { proc: p.proc, actor: p.actor, kind: p.kind, from: p.from, to: p.to, prod: p.prod }, p.page, p.size),
    p.ip && p.at ? lookupIncident(supabase, p.ip, p.at) : Promise.resolve(null),
  ]);
  const pageCount = Math.max(1, Math.ceil(log.total / p.size));
  const from = log.total === 0 ? 0 : (log.page - 1) * p.size + 1;
  const to = (log.page - 1) * p.size + log.entries.length;

  return (
    <AuditShell
      procedures={[...procedures.values()].map((x) => ({ id: x.id, name: x.name, folder: x.folder }))}
      actors={[...profiles.values()].map((x) => ({ id: x.id, name: x.display_name, initials: x.initials, color: x.color }))}
      incident={incident ? <IncidentResultView result={incident} /> : p.ip && p.at ? <p className="p-4 text-sm text-muted-foreground">That procedure or time could not be found.</p> : null}
    >
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {log.total === 0 ? (
          "No entries"
        ) : (
          <>
            Showing <span className="tabular text-foreground">{from}–{to}</span> of <span className="tabular text-foreground">{log.total.toLocaleString()}</span> entries
          </>
        )}
      </p>
      <AuditRows entries={log.entries} />
      {log.total > 0 && <AuditPager page={Math.min(log.page, pageCount)} pageCount={pageCount} />}
    </AuditShell>
  );
}

function AuditSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-28 rounded-xl" />
      <Skeleton className="h-8 w-full max-w-3xl" />
      <div className="divide-y overflow-hidden rounded-xl border">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex items-start gap-4 px-4 py-3">
            <Skeleton className="h-8 w-32" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-80 max-w-full" />
              <Skeleton className="h-3 w-48" />
            </div>
            <Skeleton className="h-5 w-36" />
          </div>
        ))}
      </div>
    </div>
  );
}
