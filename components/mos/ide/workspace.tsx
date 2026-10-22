"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  GitCommitHorizontal,
  ListChecks,
  ListTree,
  PanelBottom,
  PanelLeft,
  PanelRight,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { motion } from "motion/react";
import { usePanelRef } from "react-resizable-panels";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import { RelativeTime } from "@/components/mos/time";
import { lineDiffStats } from "@/components/mos/code/diff-stats";
import { cn } from "@/lib/utils";
import { loadCompareCode } from "@/app/(app)/snapshots/[id]/edit/actions";
import { errorLine } from "@/lib/ide/console-model";
import { CursorStore } from "@/lib/ide/cursor-store";
import { sha256Hex } from "@/lib/ide/hash";
import { problemCounts, type Problem } from "@/lib/ide/monaco-ide";
import { planInsertion, type Snippet } from "@/lib/ide/snippets";
import { getLangClient } from "@/lib/editor/lang-client";
import {
  IDE_KEYS,
  readJson,
  writeJson,
  type IdePrefs,
} from "@/lib/ide/storage";
import type {
  EditorPageData,
  IdeCodeRef,
  IdeHistoryEntry,
} from "@/lib/ide/types";
import { CatalogPanel } from "./catalog-panel";
import { ConsolePanel, type ConsoleTab } from "./console-panel";
import { EditorPane, type EditorApi } from "./editor-pane";
import { HistoryPanel } from "./history-panel";
import { Inspector } from "./inspector";
import { OutlinePanel } from "./outline-panel";
import { CollisionBanner } from "./presence";
import { ProblemsList } from "./problems-list";
import { RunPanel } from "./run-panel";
import { RunSessionProvider, useRunSession } from "./run-session";
import { StatusBar } from "./status-bar";
import { SubmitDialog } from "./submit-dialog";
import { TopBar, type CompareChoice } from "./top-bar";
import { PanelHeader, Tip, useIsClient, useModLabel } from "./ui";
import { useAutosave } from "./use-autosave";
import { useEntry, useProblems } from "./use-editor-state";
import { usePresence } from "./use-presence";
import "./ide.css";

type LeftTab = "catalog" | "outline" | "problems" | "history";

const LEFT_TABS: { id: LeftTab; label: string; icon: typeof BookOpen }[] = [
  { id: "catalog", label: "TM/TC catalog", icon: BookOpen },
  { id: "outline", label: "Outline", icon: ListTree },
  { id: "problems", label: "Problems", icon: ListChecks },
  { id: "history", label: "History", icon: GitCommitHorizontal },
];

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

export function WorkspaceSkeleton() {
  return (
    <div
      className="flex h-dvh flex-col"
      aria-busy="true"
      aria-label="Loading editor"
    >
      <div className="h-12 shrink-0 border-b bg-card/70" />
      <div className="flex min-h-0 flex-1">
        <div className="w-11 shrink-0 border-r bg-card/50" />
        <div className="w-[22%] shrink-0 border-r" />
        <div className="flex-1 space-y-2 p-6">
          {Array.from({ length: 16 }).map((_, i) => (
            <div
              key={i}
              className="h-3.5 animate-pulse rounded bg-muted"
              style={{ width: `${25 + ((i * 41) % 60)}%` }}
            />
          ))}
        </div>
        <div className="w-[27%] shrink-0 border-l" />
      </div>
      <div className="h-6 shrink-0 border-t bg-card/70" />
    </div>
  );
}

export function Workspace({
  data,
  onSubmitted,
}: {
  data: EditorPageData;
  onSubmitted?: () => void;
}) {
  const client = useIsClient();
  if (!client) return <WorkspaceSkeleton />;
  return <WorkspaceRoot initial={data} onSubmitted={onSubmitted} />;
}

/* ------------------------------------------------------------------ root */

function WorkspaceRoot({
  initial,
  onSubmitted,
}: {
  initial: EditorPageData;
  onSubmitted?: () => void;
}) {
  const [data] = useState(initial); // later server refreshes (e.g. after submit) must not swap the buffer under the user
  const [api, setApi] = useState<EditorApi | null>(null);
  const apiRef = useRef<EditorApi | null>(null);
  const entryState = useEntry(api);
  const [code, setCode] = useState(data.code);
  const [cursor] = useState(() => new CursorStore());

  // debounced copy of the buffer for analysis (outline, references, status bar hash)
  useEffect(() => {
    if (!api) return;
    const { model } = api;
    let timer: ReturnType<typeof setTimeout> | null = null;
    setTimeout(() => setCode(model.getValue()), 0);
    const sub = model.onDidChangeContent(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setCode(model.getValue()), 350);
    });
    return () => {
      sub.dispose();
      if (timer) clearTimeout(timer);
    };
  }, [api]);

  const getCode = useCallback(
    () => apiRef.current?.model.getValue() ?? data.code,
    [data.code],
  );
  const handleReady = useCallback((a: EditorApi) => {
    apiRef.current = a;
    setApi(a);
  }, []);

  useEffect(() => {
    getLangClient().warmup();
  }, []);

  return (
    <RunSessionProvider
      snapshotId={data.snapshot.id}
      mission={data.procedure.mission}
      bifrostEnabled={data.bifrostEnabled}
      getCode={getCode}
      code={code}
      entry={entryState.entry}
    >
      <WorkspaceBody
        data={data}
        api={api}
        apiRef={apiRef}
        onReady={handleReady}
        code={code}
        cursor={cursor}
        entryState={entryState}
        onSubmitted={onSubmitted}
      />
    </RunSessionProvider>
  );
}

/* ------------------------------------------------------------------ body */

function WorkspaceBody({
  data,
  api,
  apiRef,
  onReady,
  code,
  cursor,
  entryState,
  onSubmitted,
}: {
  data: EditorPageData;
  api: EditorApi | null;
  apiRef: React.RefObject<EditorApi | null>;
  onReady(a: EditorApi): void;
  code: string;
  cursor: CursorStore;
  entryState: ReturnType<typeof useEntry>;
  onSubmitted?: () => void;
}) {
  const session = useRunSession();
  const mod = useModLabel();
  const { procedure, snapshot, parent, active, history, me } = data;
  const retired = !!procedure.retiredAt;
  const [submitted, setSubmitted] = useState(false);
  const readOnly = retired || submitted;

  /* ---------------------------------------------------------------- state */
  const [leftTab, setLeftTab] = useState<LeftTab>(
    () =>
      (readJson<IdePrefs>(IDE_KEYS.prefs)?.leftTab as LeftTab | undefined) ??
      "catalog",
  );
  const [consoleTab, setConsoleTab] = useState<ConsoleTab>("console");
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [bottomOpen, setBottomOpen] = useState(true);
  const [animating, setAnimating] = useState(false);
  const [compare, setCompare] = useState<CompareChoice | null>(null);
  const [sideBySide, setSideBySide] = useState(true);
  const [hideUnchanged, setHideUnchanged] = useState(true);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [sha, setSha] = useState<string | null>(null);

  const leftRef = usePanelRef();
  const rightRef = usePanelRef();
  const bottomRef = usePanelRef();
  const hLayout = usePersistedLayout("h");
  const vLayout = usePersistedLayout("v");
  const rLayout = usePersistedLayout("r");

  /* -------------------------------------------------------------- services */
  const autosave = useAutosave({
    snapshotId: snapshot.id,
    serverCode: data.code,
    serverUpdatedAt: snapshot.updatedAt,
    model: api?.model ?? null,
    editor: api?.editor ?? null,
    enabled: !!api && !readOnly,
  });
  const presence = usePresence({
    procedureId: procedure.id,
    me,
    snapshotId: snapshot.id,
    number: snapshot.number,
    enabled: !readOnly,
  });
  const problems = useProblems(api);
  const counts = useMemo(() => problemCounts(problems), [problems]);

  useEffect(() => {
    let cancelled = false;
    void sha256Hex(code).then((h) => !cancelled && setSha(h));
    return () => {
      cancelled = true;
    };
  }, [code]);

  /* -------------------------------------------------------------- panels */
  const pulse = useCallback(() => {
    setAnimating(true);
    setTimeout(() => setAnimating(false), 340);
  }, []);
  const toggle = useCallback(
    (ref: typeof leftRef) => {
      const p = ref.current;
      if (!p) return;
      pulse();
      if (p.isCollapsed()) p.expand();
      else p.collapse();
    },
    [pulse],
  );
  const openLeft = useCallback(
    (tab: LeftTab) => {
      setLeftTab(tab);
      const prefs = readJson<IdePrefs>(IDE_KEYS.prefs) ?? {};
      writeJson(IDE_KEYS.prefs, { ...prefs, leftTab: tab } satisfies IdePrefs);
      const p = leftRef.current;
      if (p?.isCollapsed()) {
        pulse();
        p.expand();
      }
    },
    [leftRef, pulse],
  );
  const clickActivity = (tab: LeftTab) => {
    if (leftOpen && leftTab === tab) toggle(leftRef);
    else openLeft(tab);
  };
  const showConsole = useCallback(
    (tab: ConsoleTab) => {
      setConsoleTab(tab);
      const p = bottomRef.current;
      if (p?.isCollapsed()) {
        pulse();
        p.expand();
      }
    },
    [bottomRef, pulse],
  );

  /* -------------------------------------------------------------- editing */
  const reveal = useCallback(
    (line: number, column = 1, endLine?: number, endColumn?: number) => {
      const a = apiRef.current;
      if (!a) return;
      const { editor, monaco } = a;
      editor.revealLineInCenter(line, monaco.editor.ScrollType.Smooth);
      if (endLine && endColumn)
        editor.setSelection({
          startLineNumber: line,
          startColumn: column,
          endLineNumber: endLine,
          endColumn,
        });
      else editor.setPosition({ lineNumber: line, column });
      editor.focus();
    },
    [apiRef],
  );
  const revealProblem = useCallback(
    (p: Problem) => reveal(p.line, p.column, p.endLine, p.endColumn),
    [reveal],
  );

  const insertSnippet = useCallback(
    (snippet: Snippet) => {
      const a = apiRef.current;
      if (!a || readOnly) return;
      const { editor, model } = a;
      const pos = editor.getPosition() ?? {
        lineNumber: model.getLineCount(),
        column: 1,
      };
      const { edits, insertedLine } = planInsertion(
        model.getLinesContent(),
        pos.lineNumber,
        snippet,
      );
      editor.pushUndoStop();
      editor.executeEdits(
        "mos-catalog-insert",
        edits.map((e) => ({
          range: {
            startLineNumber: e.startLine,
            startColumn: e.startColumn,
            endLineNumber: e.endLine,
            endColumn: e.endColumn,
          },
          text: e.text,
          forceMoveMarkers: true,
        })),
      );
      editor.pushUndoStop();
      const line = Math.min(insertedLine, model.getLineCount());
      editor.setPosition({
        lineNumber: line,
        column: model.getLineMaxColumn(line),
      });
      editor.revealLineInCenterIfOutsideViewport(line);
      editor.focus();
    },
    [apiRef, readOnly],
  );

  const format = useCallback(async () => {
    const a = apiRef.current;
    if (!a || readOnly) return;
    const text = a.model.getValue();
    const res = await Promise.race([
      getLangClient().format(text),
      new Promise<null>((r) => setTimeout(() => r(null), 4000)),
    ]).catch(() => null);
    if (!res || res.code === text || a.model.getValue() !== text) return;
    a.editor.pushUndoStop();
    a.editor.executeEdits("mos-format", [
      { range: a.model.getFullModelRange(), text: res.code },
    ]);
    a.editor.pushUndoStop();
  }, [apiRef, readOnly]);

  const saveNow = useCallback(async () => {
    if (readOnly) return;
    await format();
    const ok = await autosave.flush();
    if (!ok)
      toast.error(
        "Could not save — your changes are kept in this browser and will be retried",
      );
  }, [format, autosave, readOnly]);

  /* -------------------------------------------------------------- compare */
  const chooseCompare = useCallback((c: CompareChoice) => {
    setCompare(c);
  }, []);
  const compareWithHistory = useCallback(
    async (h: IdeHistoryEntry) => {
      if (parent && h.id === parent.id)
        return chooseCompare({
          kind: "parent",
          ref: parent,
          label: `parent #${parent.number}`,
        });
      if (active && h.id === active.id)
        return chooseCompare({
          kind: "prod",
          ref: active,
          label: `PROD #${active.number}`,
        });
      const res = await loadCompareCode(h.id);
      if (!res.ok) return void toast.error(res.error);
      chooseCompare({
        kind: "snapshot",
        ref: res.data as IdeCodeRef,
        label: `#${h.number}`,
      });
    },
    [parent, active, chooseCompare],
  );
  const diffStats = useMemo(
    () => (compare ? lineDiffStats(compare.ref.code, code) : null),
    [compare, code],
  );

  /* ----------------------------------------------------- run error marking */
  const outcome = session.run.outcome;
  const runStatus = session.run.status;
  const errorDeco = useRef<ReturnType<
    EditorApi["editor"]["createDecorationsCollection"]
  > | null>(null);
  useEffect(() => {
    if (!api) return;
    errorDeco.current?.clear();
    errorDeco.current = null;
    if (runStatus !== "done" || outcome?.outcome !== "error") return;
    const line = errorLine(outcome.traceback);
    if (!line || line > api.model.getLineCount()) return;
    errorDeco.current = api.editor.createDecorationsCollection([
      {
        range: new api.monaco.Range(line, 1, line, 1),
        options: { isWholeLine: true, className: "mos-run-error-line" },
      },
    ]);
    return () => {
      errorDeco.current?.clear();
    };
  }, [api, runStatus, outcome]);

  /* ----------------------------------------------------------- shortcuts */
  const actions = useRef({
    run: () => {},
    stop: () => {},
    save: () => {},
    left: () => {},
    right: () => {},
    bottom: () => {},
    help: () => {},
  });
  useEffect(() => {
    actions.current = {
      run: () => void session.start(),
      stop: () => session.stop(),
      save: () => void saveNow(),
      left: () => toggle(leftRef),
      right: () => toggle(rightRef),
      bottom: () => toggle(bottomRef),
      help: () => setShortcutsOpen(true),
    };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const mod = e.metaKey || e.ctrlKey;
      const typing =
        e.target instanceof HTMLElement &&
        !!e.target.closest("input, textarea, select, [contenteditable='true']");
      const key = e.key.toLowerCase();
      if (mod && key === "s") {
        e.preventDefault();
        actions.current.save();
      } else if (mod && e.key === "Enter") {
        e.preventDefault();
        actions.current.run();
      } else if (mod && e.key === ".") {
        e.preventDefault();
        actions.current.stop();
      } else if (mod && !e.shiftKey && key === "b") {
        e.preventDefault();
        actions.current.left();
      } else if (mod && e.shiftKey && key === "l") {
        e.preventDefault();
        actions.current.right();
      } else if (e.ctrlKey && e.key === "`") {
        e.preventDefault();
        actions.current.bottom();
      } else if (
        e.key === "?" &&
        !mod &&
        !typing &&
        !(e.target instanceof HTMLElement && e.target.closest(".monaco-editor"))
      ) {
        e.preventDefault();
        actions.current.help();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const commands = useMemo(
    () => ({
      run: () => actions.current.run(),
      stop: () => actions.current.stop(),
      save: () => actions.current.save(),
    }),
    [],
  );

  /* ---------------------------------------------------------------- render */
  const submitReason = retired
    ? "This procedure is retired"
    : submitted
      ? "Already submitted"
      : !api
        ? "The editor is still loading"
        : null;
  const modelPath = `mos/draft/${snapshot.id}.py`;
  const compareProps = compare
    ? { code: compare.ref.code, key: compare.ref.id }
    : null;

  const layoutControls = (
    <>
      <Tip label="Toggle side panel" keys={[mod, "B"]}>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Toggle side panel"
          aria-pressed={leftOpen}
          onClick={() => toggle(leftRef)}
          className={cn("text-muted-foreground", leftOpen && "text-foreground")}
        >
          <PanelLeft />
        </Button>
      </Tip>
      <Tip label="Toggle console" keys={["Ctrl", "`"]}>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Toggle console"
          aria-pressed={bottomOpen}
          onClick={() => toggle(bottomRef)}
          className={cn(
            "text-muted-foreground",
            bottomOpen && "text-foreground",
          )}
        >
          <PanelBottom />
        </Button>
      </Tip>
      <Tip label="Toggle run panel" keys={[mod, "⇧", "L"]}>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Toggle run panel"
          aria-pressed={rightOpen}
          onClick={() => toggle(rightRef)}
          className={cn(
            "text-muted-foreground",
            rightOpen && "text-foreground",
          )}
        >
          <PanelRight />
        </Button>
      </Tip>
    </>
  );

  const leftHeader: Record<LeftTab, string> = {
    catalog: "TM/TC catalog",
    outline: "Outline",
    problems: `Problems · ${problems.length}`,
    history: `History · ${history.length}`,
  };

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background">
      <TopBar
        procedure={procedure}
        snapshot={snapshot}
        readOnly={readOnly}
        save={autosave.state}
        presence={presence}
        compare={compare}
        parent={parent}
        active={active}
        onCompareChoose={chooseCompare}
        onCompareStop={() => setCompare(null)}
        onCompareFromHistory={() => openLeft("history")}
        onFormat={() => void format()}
        onSubmit={() => setSubmitOpen(true)}
        submitDisabledReason={submitReason}
        layoutControls={layoutControls}
        shortcutsOpen={shortcutsOpen}
        onShortcutsOpen={setShortcutsOpen}
      />

      {retired && (
        <div
          role="status"
          className="flex shrink-0 items-start gap-2.5 border-b border-tone-danger/25 bg-tone-danger/[0.07] px-4 py-2 text-xs"
        >
          <AlertTriangle className="mt-px size-3.5 shrink-0 text-tone-danger" />
          <span>
            <strong className="font-medium text-tone-danger">
              This procedure is retired — the editor is read-only.
            </strong>
            {procedure.retiredReason && <> “{procedure.retiredReason}”.</>} You
            can still run it; restore the procedure to edit and submit.
          </span>
        </div>
      )}
      <CollisionBanner presence={presence} />
      {autosave.restorable && !readOnly && (
        <div
          role="status"
          className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-tone-info/25 bg-tone-info/[0.07] px-4 py-1.5 text-xs"
        >
          <RotateCcw className="size-3.5 text-tone-info" />
          <span>
            You have unsaved changes from{" "}
            <RelativeTime date={new Date(autosave.restorable.at)} /> that never
            reached the server.
          </span>
          <span className="ml-auto flex gap-1.5">
            <Button size="xs" onClick={autosave.restore}>
              Restore unsaved local changes
            </Button>
            <Button size="xs" variant="ghost" onClick={autosave.discardLocal}>
              <Trash2 /> Discard
            </Button>
          </span>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* activity bar */}
        <nav
          aria-label="Side panels"
          className="flex w-11 shrink-0 flex-col items-center gap-1 border-r bg-card/50 py-2"
        >
          {LEFT_TABS.map((t) => {
            const on = leftOpen && leftTab === t.id;
            const badge =
              t.id === "problems" ? counts.errors || counts.warnings : 0;
            return (
              <Tip key={t.id} label={t.label} side="right">
                <button
                  type="button"
                  aria-label={t.label}
                  aria-pressed={on}
                  onClick={() => clickActivity(t.id)}
                  className={cn(
                    "relative flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60",
                    on && "text-foreground",
                  )}
                >
                  {on && (
                    <motion.span
                      layoutId="ide-activity"
                      className="absolute inset-0 rounded-lg bg-muted"
                      transition={{
                        type: "spring",
                        stiffness: 500,
                        damping: 38,
                      }}
                    />
                  )}
                  {on && (
                    <span className="absolute top-2 -left-[5px] h-5 w-0.5 rounded-full bg-primary" />
                  )}
                  <t.icon className="relative size-4.5" />
                  {badge > 0 && (
                    <span
                      className={cn(
                        "tabular absolute top-0.5 right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-1 text-[9px] font-semibold text-white",
                        counts.errors ? "bg-tone-danger" : "bg-tone-warn",
                      )}
                    >
                      {badge > 99 ? "99+" : badge}
                    </span>
                  )}
                </button>
              </Tip>
            );
          })}
        </nav>

        <div
          className={cn(
            "min-h-0 min-w-0 flex-1",
            animating && "ide-animate-panels",
          )}
        >
          <ResizablePanelGroup
            orientation="horizontal"
            defaultLayout={hLayout.defaultLayout}
            onLayoutChanged={hLayout.onLayoutChanged}
          >
            <ResizablePanel
              id="left"
              panelRef={leftRef}
              defaultSize="23%"
              minSize="14%"
              maxSize="40%"
              collapsible
              collapsedSize={0}
              onResize={(s) => setLeftOpen(s.asPercentage > 0.5)}
            >
              <div className="flex h-full min-w-0 flex-col bg-card/30">
                <PanelHeader title={leftHeader[leftTab]} />
                <div className="min-h-0 flex-1">
                  {leftTab === "catalog" && (
                    <CatalogPanel
                      mission={procedure.mission}
                      getSource={() => apiRef.current?.model.getValue() ?? ""}
                      onInsert={insertSnippet}
                    />
                  )}
                  {leftTab === "outline" && (
                    <OutlinePanel
                      code={code}
                      entry={entryState.entry}
                      onReveal={(l) => reveal(l)}
                    />
                  )}
                  {leftTab === "problems" && (
                    <ProblemsList
                      problems={problems}
                      onReveal={revealProblem}
                    />
                  )}
                  {leftTab === "history" && (
                    <HistoryPanel
                      history={history}
                      compareId={compare?.ref.id ?? null}
                      onCompare={(h) => void compareWithHistory(h)}
                      onClearCompare={() => setCompare(null)}
                    />
                  )}
                </div>
              </div>
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel id="center" minSize="30%">
              <ResizablePanelGroup
                orientation="vertical"
                defaultLayout={vLayout.defaultLayout}
                onLayoutChanged={vLayout.onLayoutChanged}
              >
                <ResizablePanel id="editor" minSize="25%">
                  <div className="flex h-full min-h-0 flex-col">
                    {compare && diffStats && (
                      <div className="flex h-8 shrink-0 items-center gap-3 border-b bg-tone-info/[0.06] px-3 text-xs">
                        <span className="font-medium text-tone-info">
                          Comparing{" "}
                          <span className="font-mono">#{snapshot.number}</span>{" "}
                          (live) against {compare.label}
                        </span>
                        <span className="tabular font-mono text-tone-success">
                          +{diffStats.added}
                        </span>
                        <span className="tabular font-mono text-tone-danger">
                          −{diffStats.removed}
                        </span>
                        <span className="ml-auto flex items-center gap-1">
                          <Button
                            size="xs"
                            variant={sideBySide ? "secondary" : "ghost"}
                            onClick={() => setSideBySide(true)}
                          >
                            Side by side
                          </Button>
                          <Button
                            size="xs"
                            variant={!sideBySide ? "secondary" : "ghost"}
                            onClick={() => setSideBySide(false)}
                          >
                            Inline
                          </Button>
                          <Button
                            size="xs"
                            variant={hideUnchanged ? "secondary" : "ghost"}
                            onClick={() => setHideUnchanged((h) => !h)}
                          >
                            Hide unchanged
                          </Button>
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => setCompare(null)}
                          >
                            Close
                          </Button>
                        </span>
                      </div>
                    )}
                    <div className="min-h-0 flex-1">
                      <EditorPane
                        modelPath={modelPath}
                        initialCode={data.code}
                        mission={procedure.mission}
                        compare={compareProps}
                        sideBySide={sideBySide}
                        hideUnchanged={hideUnchanged}
                        readOnly={readOnly}
                        onReady={onReady}
                        onCursor={(p) => cursor.set(p)}
                        commands={commands}
                      />
                    </div>
                  </div>
                </ResizablePanel>
                <ResizableHandle />
                <ResizablePanel
                  id="console"
                  panelRef={bottomRef}
                  defaultSize="34%"
                  minSize="12%"
                  collapsible
                  collapsedSize={0}
                  onResize={(s) => setBottomOpen(s.asPercentage > 0.5)}
                >
                  <ConsolePanel
                    tab={consoleTab}
                    onTab={setConsoleTab}
                    problems={problems}
                    onRevealLine={(l) => reveal(l)}
                    onRevealProblem={revealProblem}
                  />
                </ResizablePanel>
              </ResizablePanelGroup>
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel
              id="right"
              panelRef={rightRef}
              defaultSize="27%"
              minSize="20%"
              maxSize="46%"
              collapsible
              collapsedSize={0}
              onResize={(s) => setRightOpen(s.asPercentage > 0.5)}
            >
              <ResizablePanelGroup
                orientation="vertical"
                defaultLayout={rLayout.defaultLayout}
                onLayoutChanged={rLayout.onLayoutChanged}
              >
                <ResizablePanel id="run" minSize="35%">
                  <RunPanel />
                </ResizablePanel>
                <ResizableHandle />
                <ResizablePanel id="inspector" defaultSize="38%" minSize="12%">
                  <Inspector />
                </ResizablePanel>
              </ResizablePanelGroup>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      </div>

      <StatusBar
        cursor={cursor}
        mission={procedure.mission}
        catalog={session.catalog}
        errors={counts.errors}
        warnings={counts.warnings}
        onProblems={() =>
          leftTab === "problems" && leftOpen
            ? showConsole("problems")
            : openLeft("problems")
        }
        sha={sha}
        autosave={!readOnly}
      />

      <SubmitDialog
        open={submitOpen}
        onOpenChange={setSubmitOpen}
        api={api}
        mission={procedure.mission}
        snapshot={snapshot}
        parent={parent}
        flush={autosave.flush}
        onRunNow={() => void session.start()}
        onSubmitted={() => {
          setSubmitted(true);
          onSubmitted?.();
        }}
      />
    </div>
  );
}
