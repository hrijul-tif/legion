import { Suspense } from "react";
import type { Metadata } from "next";
import { PageBody, PageHeader } from "@/components/mos/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { NewProcedureDialog } from "@/components/mos/procedure/new-procedure-dialog";
import { ProcedureFilters } from "@/components/mos/procedure/procedure-filters";
import { ProcedureList } from "@/components/mos/procedure/procedure-list";
import { ProcedureSummary, ProcedureSummarySkeleton } from "@/components/mos/procedure/procedure-summary";
import { loadProcedureFilters } from "@/components/mos/procedure/search-params";
import { getCurrentUser } from "@/lib/auth";
import { hasRole } from "@/lib/lifecycle";
import { getProcedureStats, listFolders, listProcedures } from "@/lib/data/procedures";

export const metadata: Metadata = { title: "Procedures" };

export default function ProceduresPage({ searchParams }: PageProps<"/procedures">) {
  return (
    <>
      <PageHeader
        title="Procedures"
        description="Every procedure, what PROD can run today, and what is still working its way through review, test and approval."
        actions={
          <Suspense fallback={<Skeleton className="h-8 w-36 rounded-lg" />}>
            <NewProcedureAction />
          </Suspense>
        }
      />
      <PageBody className="space-y-5">
        <Suspense fallback={<ProcedureSummarySkeleton />}>
          <Summary />
        </Suspense>
        <Suspense fallback={<ListSkeleton />}>
          <Library searchParams={searchParams} />
        </Suspense>
      </PageBody>
    </>
  );
}

async function NewProcedureAction() {
  const [user, folders] = await Promise.all([getCurrentUser(), listFolders()]);
  if (!hasRole(user.roles, "author")) return null;
  return <NewProcedureDialog folders={folders} />;
}

async function Summary() {
  return <ProcedureSummary stats={await getProcedureStats()} />;
}

async function Library({ searchParams }: { searchParams: PageProps<"/procedures">["searchParams"] }) {
  const filters = await loadProcedureFilters(searchParams);
  const [user, folders, { rows, count }] = await Promise.all([
    getCurrentUser(),
    listFolders(),
    listProcedures({ ...filters, page: Math.max(1, filters.page) }),
  ]);
  const filtered = !!filters.q || !!filters.mission || !!filters.area || filters.status.length > 0;
  return (
    <div className="space-y-4">
      <ProcedureFilters folders={folders} />
      <ProcedureList rows={rows} count={count} page={Math.max(1, filters.page)} filtered={filtered} canCreate={hasRole(user.roles, "author")} />
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Skeleton className="h-8 w-72 rounded-lg" />
        <Skeleton className="h-8 w-40 rounded-lg" />
        <Skeleton className="h-8 w-36 rounded-lg" />
      </div>
      <div className="overflow-hidden rounded-xl border">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b px-4 py-3.5 last:border-0">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/4" />
            </div>
            <Skeleton className="hidden h-8 w-40 lg:block" />
            <Skeleton className="hidden h-5 w-48 lg:block" />
          </div>
        ))}
      </div>
    </div>
  );
}
