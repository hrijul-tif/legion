import { Suspense } from "react";
import type { Metadata } from "next";
import { EditShell } from "@/components/mos/ide/edit-shell";
import { WorkspaceSkeleton } from "@/components/mos/ide/workspace";
import { loadEditPage } from "@/lib/ide/load";

export const metadata: Metadata = { title: "Editor" };

export default function EditPage({ params }: PageProps<"/snapshots/[id]/edit">) {
  return (
    <Suspense fallback={<WorkspaceSkeleton />}>
      <Loader params={params} />
    </Suspense>
  );
}

async function Loader({ params }: { params: PageProps<"/snapshots/[id]/edit">["params"] }) {
  const { id } = await params;
  const load = await loadEditPage(id);
  return <EditShell load={load} />;
}
