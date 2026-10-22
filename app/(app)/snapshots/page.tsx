import type { Metadata } from "next";
import { Suspense } from "react";
import { createLoader } from "nuqs/server";
import { PageBody, PageHeader } from "@/components/mos/page-header";
import { SnapshotTableSkeleton } from "@/components/mos/tables/snapshot-table";
import { snapshotParsers } from "@/components/mos/tables/snapshot-params";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentUser } from "@/lib/auth";
import { fetchProcedures, fetchProfiles } from "@/lib/data/audit";
import { querySnapshots } from "@/lib/data/snapshots";
import { createClient } from "@/lib/supabase/server";
import { ExplorerResults } from "./_components/explorer-results";
import { ExplorerShell } from "./_components/explorer-shell";

export const metadata: Metadata = { title: "Snapshots" };

const loadParams = createLoader(snapshotParsers);

export default function SnapshotsPage({ searchParams }: PageProps<"/snapshots">) {
  return (
    <>
      <PageHeader title="Snapshots" description="Every frozen version of every procedure. Filter by state, author or procedure; the URL is the view, so share it." />
      <PageBody>
        <Suspense fallback={<ExplorerSkeleton />}>
          <Explorer searchParams={searchParams} />
        </Suspense>
      </PageBody>
    </>
  );
}

async function Explorer({ searchParams }: { searchParams: PageProps<"/snapshots">["searchParams"] }) {
  const params = await loadParams(searchParams);
  const [user, supabase] = await Promise.all([getCurrentUser(), createClient()]);
  const [result, procedures, profiles] = await Promise.all([querySnapshots(supabase, params), fetchProcedures(supabase), fetchProfiles(supabase)]);

  return (
    <ExplorerShell
      me={user.id}
      procedures={[...procedures.values()].map((p) => ({ id: p.id, name: p.name, folder: p.folder }))}
      authors={[...profiles.values()].map((p) => ({ id: p.id, name: p.display_name, initials: p.initials, color: p.color }))}
    >
      <ExplorerResults rows={result.rows} total={result.total} page={result.page} pageCount={result.pageCount} />
    </ExplorerShell>
  );
}

function ExplorerSkeleton() {
  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <Skeleton className="h-7 w-96 max-w-full" />
        <Skeleton className="h-8 w-full max-w-3xl" />
        <Skeleton className="h-6 w-full max-w-2xl" />
      </div>
      <SnapshotTableSkeleton />
    </div>
  );
}
