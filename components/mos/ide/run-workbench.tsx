"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  FileCode2,
  FlaskConical,
  PencilLine,
} from "lucide-react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import {
  CodeViewer,
  type CodeViewerHandle,
} from "@/components/mos/code/code-viewer";
import { StateBadge } from "@/components/mos/state-badge";
import { SnapshotRef } from "@/components/mos/hash";
import { UserChip } from "@/components/mos/user-avatar";
import { IDE_KEYS, readJson, writeJson } from "@/lib/ide/storage";
import type { RunPageData } from "@/lib/ide/types";
import { ConsolePanel, type ConsoleTab } from "./console-panel";
import { Inspector } from "./inspector";
import { RunPanel, RunStatus } from "./run-panel";
import { RunSessionProvider, useRunSession } from "./run-session";
import { LangPills } from "./status-bar";
import { useIsClient, useMountedWhileVisible } from "./ui";
import { WorkspaceSkeleton } from "./workspace";
import "./ide.css";

function usePersistedLayout(name: string) {
  const key = IDE_KEYS.layout(name);
  const [initial] = useState(
    () => readJson<Record<string, number>>(key) ?? undefined,
  );
  const save = useCallback(
    (layout: Record<string, number>) => void writeJson(key, layout),
    [key],
  );
  return { defaultLayout: initial, onLayoutChanged: save };
}

export function RunWorkbench({ data }: { data: RunPageData }) {
  const client = useIsClient();
  if (!client) return <WorkspaceSkeleton />;
  if (data.ownDraft) return <OwnDraftNotice data={data} />;
  return (
    <RunSessionProvider
      snapshotId={data.snapshot.id}
      mission={data.procedure.mission}
      bifrostEnabled={data.bifrostEnabled}
      getCode={() => data.code}
      code={data.code}
    >
      <Body data={data} />
    </RunSessionProvider>
  );
}

function OwnDraftNotice({ data }: { data: RunPageData }) {
  return (
    <div className="bg-grid flex h-dvh items-center justify-center p-6">
      <div className="w-full max-w-md space-y-4 rounded-2xl border bg-card p-6 text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full border bg-muted/50 text-muted-foreground">
          <PencilLine className="size-5" />
        </span>
        <div className="space-y-1.5">
          <h1 className="text-lg font-semibold tracking-tight">
            This is your working copy
          </h1>
          <p className="text-sm text-muted-foreground">
            Run it from the editor, where the buffer on screen is exactly what
            runs, with the same arguments, faults and spacecraft inspector.
          </p>
        </div>
        <Button asChild>
          <Link href={`/snapshots/${data.snapshot.id}/edit`}>
            Open in the editor <ArrowUpRight />
          </Link>
        </Button>
      </div>
    </div>
  );
}

function Body({ data }: { data: RunPageData }) {
  const session = useRunSession();
  const { procedure, snapshot } = data;
  const viewer = useRef<CodeViewerHandle>(null);
  const alive = useMountedWhileVisible();
  const [focusLine, setFocusLine] = useState<number | null>(null);
  const [tab, setTab] = useState<ConsoleTab>("console");
  const h = usePersistedLayout("run-h");
  const r = usePersistedLayout("run-r");
  const c = usePersistedLayout("run-c");

  const reveal = useCallback((line: number) => {
    viewer.current?.revealLine(line);
    setFocusLine(line);
    setTimeout(() => setFocusLine((cur) => (cur === line ? null : cur)), 2500);
  }, []);

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background">
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b bg-card/70 px-4">
        <div className="flex min-w-0 items-center gap-2.5 text-sm">
          <FlaskConical className="size-4 shrink-0 text-primary" />
          <Link
            href={`/procedures/${procedure.id}`}
            className="max-w-[28ch] truncate font-mono text-[13px] font-semibold hover:underline"
            title={procedure.name}
          >
            {procedure.name}
          </Link>
          <Link
            href={`/snapshots/${snapshot.id}`}
            className="rounded hover:underline"
          >
            <SnapshotRef number={snapshot.number} sha={snapshot.sha} />
          </Link>
          <StateBadge state={snapshot.state} size="xs" short />
          <span className="hidden items-center gap-1.5 text-xs text-muted-foreground lg:inline-flex">
            by <UserChip user={snapshot.author} className="text-xs" />
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-4">
          <p className="hidden text-xs text-muted-foreground xl:block">
            Runs here are recorded and can be attached as test evidence
          </p>
          <RunStatus session={session} />
          <Button asChild variant="outline" size="sm">
            <Link href={`/snapshots/${snapshot.id}`}>
              <FileCode2 /> Snapshot
            </Link>
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1">
        <ResizablePanelGroup
          orientation="horizontal"
          defaultLayout={h.defaultLayout}
          onLayoutChanged={h.onLayoutChanged}
        >
          <ResizablePanel id="code" defaultSize="40%" minSize="20%">
            <div className="flex h-full min-h-0 flex-col">
              <div className="flex h-9 shrink-0 items-center justify-between border-b px-3">
                <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                  Source · read-only
                </span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {data.code.split("\n").length} lines
                </span>
              </div>
              <div className="min-h-0 flex-1">
                {alive && (
                  <CodeViewer
                    code={data.code}
                    path={`mos/run/${snapshot.id}.py`}
                    mission={procedure.mission}
                    focusLine={focusLine}
                    handleRef={viewer}
                  />
                )}
              </div>
            </div>
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel id="work" minSize="35%">
            <ResizablePanelGroup
              orientation="vertical"
              defaultLayout={r.defaultLayout}
              onLayoutChanged={r.onLayoutChanged}
            >
              <ResizablePanel id="controls" defaultSize="58%" minSize="25%">
                <ResizablePanelGroup
                  orientation="horizontal"
                  defaultLayout={c.defaultLayout}
                  onLayoutChanged={c.onLayoutChanged}
                >
                  <ResizablePanel id="run" defaultSize="52%" minSize="30%">
                    <RunPanel hideHeader />
                  </ResizablePanel>
                  <ResizableHandle />
                  <ResizablePanel id="inspector" minSize="25%">
                    <Inspector />
                  </ResizablePanel>
                </ResizablePanelGroup>
              </ResizablePanel>
              <ResizableHandle />
              <ResizablePanel id="console" minSize="15%">
                <ConsolePanel
                  tab={tab}
                  onTab={setTab}
                  problems={null}
                  onRevealLine={reveal}
                />
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      <footer className="flex h-6 shrink-0 items-center justify-between border-t bg-card/70 px-3 text-[11px] text-muted-foreground">
        <span>Python 3.14 · Pyodide</span>
        <span className="hidden md:inline">
          <LangPills />
        </span>
      </footer>
    </div>
  );
}
