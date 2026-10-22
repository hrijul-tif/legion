import { Suspense } from "react";
import type { Metadata } from "next";
import { RunWorkbench } from "@/components/mos/ide/run-workbench";
import { WorkspaceSkeleton } from "@/components/mos/ide/workspace";
import { loadRunPage } from "@/lib/ide/load";

export const metadata: Metadata = { title: "Dry run" };

export default function RunPage({ params }: PageProps<"/snapshots/[id]/run">) {
  return (
    <Suspense fallback={<WorkspaceSkeleton />}>
      <Loader params={params} />
    </Suspense>
  );
}

async function Loader({ params }: { params: PageProps<"/snapshots/[id]/run">["params"] }) {
  const { id } = await params;
  const data = await loadRunPage(id);
  return <RunWorkbench data={data} />;
}
