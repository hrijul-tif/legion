import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/mos/page-header";
import { CatalogBrowser } from "./_components/catalog-browser";

export const metadata: Metadata = { title: "TM/TC catalog" };

export default function CatalogPage() {
  return (
    <Suspense fallback={<PageHeader title="TM/TC catalog" description="Loading the catalog…" />}>
      <CatalogBrowser />
    </Suspense>
  );
}
