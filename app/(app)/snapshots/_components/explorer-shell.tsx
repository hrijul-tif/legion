"use client";

import { ExplorerProvider } from "./explorer-context";
import { ExplorerFilters, type AuthorOption, type ProcedureOption } from "./explorer-filters";

/** Owns the URL state; the server-rendered results arrive as children and read it through context. */
export function ExplorerShell({ procedures, authors, me, children }: { procedures: ProcedureOption[]; authors: AuthorOption[]; me: string; children: React.ReactNode }) {
  return (
    <ExplorerProvider>
      <div className="space-y-5">
        <ExplorerFilters procedures={procedures} authors={authors} me={me} />
        {children}
      </div>
    </ExplorerProvider>
  );
}
