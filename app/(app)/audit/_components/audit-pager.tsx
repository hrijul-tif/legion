"use client";

import { AUDIT_PAGE_SIZES } from "@/components/mos/tables/audit-params";
import { Pager } from "@/components/mos/tables/pager";
import { useAudit } from "./audit-context";

export function AuditPager({ page, pageCount }: { page: number; pageCount: number }) {
  const { params, update } = useAudit();
  return (
    <Pager
      page={page}
      pageCount={pageCount}
      size={params.size}
      sizes={AUDIT_PAGE_SIZES}
      onPage={(p) => update({ page: p <= 1 ? null : p })}
      onSize={(n) => update({ size: n as (typeof AUDIT_PAGE_SIZES)[number] })}
    />
  );
}
