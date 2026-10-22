import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { loadSnapshotPage } from "@/lib/data/snapshot";
import { SnapshotView } from "./_components/snapshot-view";

export const metadata: Metadata = { title: "Snapshot" };

export default function SnapshotPage(props: PageProps<"/snapshots/[id]">) {
  return (
    <Suspense fallback={<SnapshotSkeleton />}>
      <SnapshotContent params={props.params} />
    </Suspense>
  );
}

async function SnapshotContent({ params }: { params: PageProps<"/snapshots/[id]">["params"] }) {
  const { id } = await params;
  const data = await loadSnapshotPage(id);
  // keyed by snapshot so navigating between snapshots starts from a clean client state
  return <SnapshotView key={data.snapshot.id} data={data} />;
}

function SnapshotSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading snapshot">
      <div className="space-y-4 border-b px-6 pt-5 pb-5 lg:px-8">
        <Skeleton className="h-3.5 w-56" />
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-7 w-24 rounded-full" />
          <Skeleton className="h-7 w-44 rounded-full" />
        </div>
        <Skeleton className="h-4 w-96" />
        <Skeleton className="h-4 w-[34rem] max-w-full" />
      </div>
      <div className="space-y-5 px-6 py-5 lg:px-8">
        <Skeleton className="h-64 w-full rounded-xl" />
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-[420px] w-full rounded-xl" />
          </div>
          <div className="space-y-3">
            <Skeleton className="h-56 w-full rounded-xl" />
            <Skeleton className="h-20 w-full rounded-xl" />
          </div>
        </div>
      </div>
    </div>
  );
}
