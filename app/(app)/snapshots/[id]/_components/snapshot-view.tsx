"use client";

import { useEffect, useMemo, useState } from "react";
import { parseAsInteger, parseAsString, parseAsStringLiteral, useQueryState } from "nuqs";
import { ChevronDown, FileCode2, History, MessageSquareText, PanelRightClose, PanelRightOpen, ShieldCheck, FlaskConical } from "lucide-react";
import { LifecycleDiagram, type DiagramAction } from "@/components/mos/lifecycle-diagram";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { STATE_META, hasRole, type ManualAction } from "@/lib/lifecycle";
import type { SnapshotPageData } from "@/lib/data/snapshot";
import { TABS, defaultTabFor, parentSibling, type TabKey } from "./derive";
import { prefetchCompare } from "./compare";
import { SnapshotHeader } from "./header";
import { ActionPanel, computeAvailability } from "./action-panel";
import { ActionDialog } from "./action-dialog";
import { WithdrawFlowDialog } from "./withdraw-flow";
import { CodeTab } from "./code-tab";
import { ReviewTab } from "./review-tab";
import { TestTab } from "./test-tab";
import { ApprovalTab } from "./approval-tab";
import { HistoryTab } from "./history-tab";

const TAB_META: Record<TabKey, { label: string; icon: React.ReactNode }> = {
  code: { label: "Code", icon: <FileCode2 /> },
  review: { label: "Review", icon: <MessageSquareText /> },
  test: { label: "Test", icon: <FlaskConical /> },
  approval: { label: "Approval", icon: <ShieldCheck /> },
  history: { label: "History", icon: <History /> },
};

const DIAGRAM_KEY = "mos.snapshot.lifecycle-open";

export function SnapshotView({ data }: { data: SnapshotPageData }) {
  const state = data.snapshot.state;
  const fallbackTab = defaultTabFor(state);
  const [tab, setTab] = useQueryState("tab", parseAsStringLiteral(TABS).withDefault(fallbackTab).withOptions({ history: "push" }));
  const [compare, setCompare] = useQueryState("compare", parseAsString.withDefault("parent").withOptions({ history: "replace" }));
  const [line, setLine] = useQueryState("line", parseAsInteger.withOptions({ history: "replace" }));

  // Heavy tabs (Monaco) stay mounted once visited so switching back is instant.
  const [visited, setVisited] = useState<TabKey[]>([tab]);
  if (!visited.includes(tab)) setVisited([...visited, tab]);

  const [actionOpen, setActionOpen] = useState(false);
  const [action, setAction] = useState<ManualAction>("review_pass");
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [diagramOpen, setDiagramOpen] = useState(true);
  const [wide, setWide] = useState(false);

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (localStorage.getItem(DIAGRAM_KEY) === "0") setDiagramOpen(false);
    } catch {
      /* storage unavailable */
    }
  }, []);
  const toggleDiagram = () => {
    const next = !diagramOpen;
    setDiagramOpen(next);
    try {
      localStorage.setItem(DIAGRAM_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  // Warm the default diff target while the reader is still on another tab.
  const parent = parentSibling(data);
  useEffect(() => {
    prefetchCompare(parent?.id);
  }, [parent?.id]);

  const avail = useMemo(() => computeAvailability(data), [data]);
  const canGuidedWithdraw = state === "approved" && hasRole(data.me.roles, "approver") && !data.procedure.retired_at;
  const ownTransitions = useMemo(() => data.transitions.filter((t) => t.snapshot_id === data.snapshot.id), [data.transitions, data.snapshot.id]);

  const openAction = (a: DiagramAction) => {
    if (a === "withdraw_guided") setWithdrawOpen(true);
    else {
      setAction(a);
      setActionOpen(true);
    }
  };

  const unresolved = data.comments.filter((c) => !c.resolved_at).length;
  const badge: Partial<Record<TabKey, { n: number; warn?: boolean }>> = {
    review: unresolved > 0 ? { n: unresolved, warn: true } : data.comments.length > 0 ? { n: data.comments.length } : undefined,
    test: data.tests.length > 0 ? { n: data.tests.length } : undefined,
    history: { n: ownTransitions.length },
  };

  const goReview = (l: number | null, cmp?: string) => {
    if (cmp) void setCompare(cmp);
    void setLine(l);
    void setTab("review");
  };

  return (
    <div>
      <SnapshotHeader data={data} />

      <div className="space-y-5 px-6 py-5 lg:px-8">
        {!wide && (
          <section aria-label="Lifecycle" className="overflow-hidden rounded-xl border bg-card bg-grid">
            <button
              type="button"
              onClick={toggleDiagram}
              aria-expanded={diagramOpen}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left outline-none hover:bg-muted/30 focus-visible:bg-muted/40"
            >
              <span className="text-sm font-medium">Lifecycle</span>
              <span className="hidden text-[13px] text-muted-foreground sm:inline">
                {STATE_META[state].code} · {STATE_META[state].label}
              </span>
              {!diagramOpen && (
                <span className="ml-auto mr-2 w-64 max-w-[40%]">
                  <LifecycleDiagram state={state} transitions={ownTransitions} compact />
                </span>
              )}
              <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", diagramOpen ? "ml-auto" : "-rotate-90")} />
            </button>
            {diagramOpen && (
              <div className="px-4 pt-1 pb-3">
                <LifecycleDiagram
                  state={state}
                  transitions={ownTransitions}
                  available={avail}
                  canGuidedWithdraw={canGuidedWithdraw}
                  onAction={openAction}
                />
              </div>
            )}
          </section>
        )}

        <div className={cn("grid items-start gap-6", wide ? "grid-cols-1" : "lg:grid-cols-[minmax(0,1fr)_20rem]")}>
          <div className="min-w-0">
            <Tabs value={tab} onValueChange={(v) => void setTab(v as TabKey)} className="gap-4">
              <div className="flex items-center justify-between gap-3 border-b">
                <TabsList variant="line" className="w-auto justify-start gap-1 group-data-horizontal/tabs:h-9">
                  {TABS.map((k) => {
                    const b = badge[k];
                    return (
                      <TabsTrigger key={k} value={k} className="h-9 gap-1.5 px-3 text-[13px]">
                        {TAB_META[k].icon}
                        <span className="max-sm:sr-only">{TAB_META[k].label}</span>
                        {b && (
                          <span
                            className={cn(
                              "tabular rounded-full px-1.5 text-[11px] leading-[18px]",
                              b.warn ? "bg-tone-warn/15 text-tone-warn" : "bg-muted text-muted-foreground",
                            )}
                          >
                            {b.n}
                          </span>
                        )}
                      </TabsTrigger>
                    );
                  })}
                </TabsList>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon-sm" className="hidden lg:inline-flex" aria-pressed={wide} aria-label={wide ? "Show actions and lifecycle" : "Give the code more room"} onClick={() => setWide((w) => !w)}>
                      {wide ? <PanelRightOpen /> : <PanelRightClose />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{wide ? "Show the action panel" : "Wide view — hide the action panel"}</TooltipContent>
                </Tooltip>
              </div>
            </Tabs>

            {TABS.map(
              (k) =>
                visited.includes(k) && (
                  <div key={k} hidden={tab !== k} role="tabpanel" aria-label={TAB_META[k].label} className="pt-1 outline-none">
                    {k === "code" && <CodeTab data={data} onJumpToLine={(l) => goReview(l)} />}
                    {k === "review" && (
                      <ReviewTab data={data} compare={compare} onCompareChange={(v) => void setCompare(v)} focusLine={line} onFocusLine={(l) => void setLine(l)} />
                    )}
                    {k === "test" && <TestTab data={data} />}
                    {k === "approval" && <ApprovalTab data={data} onViewDiff={() => goReview(null, "active")} onGoto={(t) => void setTab(t)} />}
                    {k === "history" && <HistoryTab data={data} />}
                  </div>
                ),
            )}
          </div>

          {!wide && <ActionPanel data={data} onAction={(a) => openAction(a)} onWithdrawFlow={() => setWithdrawOpen(true)} />}
        </div>
      </div>

      <ActionDialog data={data} action={action} open={actionOpen} onOpenChange={setActionOpen} />
      <WithdrawFlowDialog data={data} open={withdrawOpen} onOpenChange={setWithdrawOpen} />
    </div>
  );
}
