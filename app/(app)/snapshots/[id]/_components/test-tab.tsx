"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronRight, FlaskConical, Loader2, PlayCircle, Plus } from "lucide-react";
import { toast } from "sonner";
import { addTestRecord } from "@/app/actions/collab";
import { RelativeTime } from "@/components/mos/time";
import { TONE_CLASSES } from "@/components/mos/state-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { hasRole } from "@/lib/lifecycle";
import type { RunListRow, SnapshotPageData } from "@/lib/data/snapshot";
import type { RunOutcome, TestRecord } from "@/lib/data/types";
import { formatDuration, person } from "./derive";
import { EmptyNote, Pill, SectionCard, Who } from "./bits";
import { RunLog, RunLogSkeleton, useRunDetail, type RunEvent } from "./run-log";

type Tone = Parameters<typeof Pill>[0]["tone"];

export const RESULT_TONE: Record<TestRecord["result"], Tone> = { pass: "success", fail: "danger", blocked: "warn" };
export const OUTCOME_TONE: Record<RunOutcome, Tone> = { completed: "success", error: "danger", running: "progress", stopped: "warn", skipped: "muted", choose: "info" };

export function TestTab({ data }: { data: SnapshotPageData }) {
  const { snapshot: s, tests, runs, me } = data;
  const pass = tests.filter((t) => t.result === "pass").length;
  const fail = tests.filter((t) => t.result === "fail").length;
  const blocked = tests.filter((t) => t.result === "blocked").length;
  const [openRun, setOpenRun] = useState<string | null>(null);
  const canAdd = s.state === "test_in_progress" && hasRole(me.roles, "tester");

  const showRun = (id: string) => {
    setOpenRun(id);
    requestAnimationFrame(() => document.getElementById(`run-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          {tests.length === 0 ? (
            <span className="text-muted-foreground">No test cases recorded yet.</span>
          ) : (
            <>
              <Pill tone="success">{pass} passed</Pill>
              {fail > 0 && <Pill tone="danger">{fail} failed</Pill>}
              {blocked > 0 && <Pill tone="warn">{blocked} blocked</Pill>}
            </>
          )}
          <span className="text-muted-foreground">
            · {runs.length} dry run{runs.length === 1 ? "" : "s"}
          </span>
        </div>
        {s.state !== "in_progress" && (
          <Button asChild variant="outline" size="sm">
            <Link href={`/snapshots/${s.id}/run`}>
              <PlayCircle /> Dry run this snapshot
            </Link>
          </Button>
        )}
      </div>

      <SectionCard title="Test cases" icon={<FlaskConical />} bodyClassName="p-0">
        {tests.length === 0 ? (
          <div className="p-4">
            <EmptyNote icon={<FlaskConical />} title="Nothing recorded yet">
              Testers record each case they ran — what, the result, and the dry run that proves it. These become the evidence an approver sees.
            </EmptyNote>
          </div>
        ) : (
          <ul className="divide-y">
            {tests.map((t) => {
              const tester = person(data, t.tester_id);
              const run = t.run_id ? runs.find((r) => r.id === t.run_id) : null;
              return (
                <li key={t.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3">
                  <Pill tone={RESULT_TONE[t.result]} className="mt-0.5 w-16 justify-center capitalize">
                    {t.result}
                  </Pill>
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-sm font-medium">{t.name}</p>
                    {t.notes && <p className="text-[13px] leading-relaxed whitespace-pre-wrap text-muted-foreground">{t.notes}</p>}
                    {run && (
                      <button
                        type="button"
                        onClick={() => showRun(run.id)}
                        className="inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60"
                      >
                        <PlayCircle className="size-3 text-muted-foreground" /> Run on {run.target} ·
                        <span className={cn("capitalize", TONE_CLASSES[OUTCOME_TONE[run.outcome]].text)}>{run.outcome}</span>
                        <RelativeTime date={run.started_at} className="text-muted-foreground" />
                      </button>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    <Who user={tester} size={18} className="text-foreground" />
                    <RelativeTime date={t.created_at} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {canAdd && <AddTestCase data={data} />}
        {s.state === "test_in_progress" && !canAdd && <p className="border-t px-4 py-3 text-xs text-muted-foreground">Only testers can add test cases while this snapshot is in test.</p>}
      </SectionCard>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Dry runs</h3>
        {runs.length === 0 ? (
          <EmptyNote icon={<PlayCircle />} title="No dry runs for this snapshot">
            Dry runs execute the procedure against the mock spacecraft in your browser. Start one with “Dry run this snapshot”, and its log lands here.
          </EmptyNote>
        ) : (
          <ul className="space-y-2">
            {runs.map((r) => (
              <RunItem key={r.id} run={r} data={data} open={openRun === r.id} onToggle={() => setOpenRun(openRun === r.id ? null : r.id)} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function AddTestCase({ data }: { data: SnapshotPageData }) {
  const [name, setName] = useState("");
  const [result, setResult] = useState<TestRecord["result"]>("pass");
  const [notes, setNotes] = useState("");
  const [runId, setRunId] = useState<string>("none");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    const res = await addTestRecord({ snapshot_id: data.snapshot.id, name: name.trim(), result, notes: notes.trim(), run_id: runId === "none" ? null : runId });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(`Recorded “${name.trim()}” as ${result}`);
    setName("");
    setNotes("");
    setRunId("none");
    setResult("pass");
  };

  return (
    <form
      className="space-y-3 border-t bg-muted/20 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <Plus className="size-4 text-muted-foreground" /> Add a test case
      </p>
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="space-y-1.5">
          <Label htmlFor="tc-name" className="text-xs">
            What did you test?
          </Label>
          <Input id="tc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Nominal run, all subsystems healthy" disabled={busy} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Result</Label>
          <ToggleGroup type="single" variant="outline" size="sm" value={result} onValueChange={(v) => v && setResult(v as TestRecord["result"])} aria-label="Result">
            <ToggleGroupItem value="pass" className="data-[state=on]:bg-tone-success/15 data-[state=on]:text-tone-success">
              Pass
            </ToggleGroupItem>
            <ToggleGroupItem value="fail" className="data-[state=on]:bg-tone-danger/15 data-[state=on]:text-tone-danger">
              Fail
            </ToggleGroupItem>
            <ToggleGroupItem value="blocked" className="data-[state=on]:bg-tone-warn/15 data-[state=on]:text-tone-warn">
              Blocked
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="space-y-1.5">
          <Label htmlFor="tc-notes" className="text-xs">
            Notes <span className="text-muted-foreground">(optional)</span>
          </Label>
          <Textarea id="tc-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} disabled={busy} placeholder="What you saw, fault injected, prompts answered…" className="resize-none text-sm" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">
            Linked dry run <span className="text-muted-foreground">(optional)</span>
          </Label>
          <Select value={runId} onValueChange={setRunId} disabled={busy}>
            <SelectTrigger className="w-full" aria-label="Linked dry run">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No run</SelectItem>
              {data.runs.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.target} · {r.outcome} · {new Date(r.started_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={!name.trim() || busy}>
          {busy && <Loader2 className="animate-spin" />} Record test case
        </Button>
      </div>
    </form>
  );
}

function RunItem({ run, data, open, onToggle }: { run: RunListRow; data: SnapshotPageData; open: boolean; onToggle: () => void }) {
  const detail = useRunDetail(run.id, open);
  const by = person(data, run.started_by);
  const sm = run.summary ?? {};
  const duration = sm.virtualSeconds ?? (run.ended_at ? (new Date(run.ended_at).getTime() - new Date(run.started_at).getTime()) / 1000 : undefined);
  const events = (detail.run?.events ?? []) as RunEvent[];

  return (
    <li id={`run-${run.id}`} className={cn("overflow-hidden rounded-xl border bg-card transition-shadow", open && "ring-1 ring-primary/30")}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 text-left outline-none hover:bg-muted/40 focus-visible:bg-muted/50"
      >
        <ChevronRight className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
        <Pill tone={OUTCOME_TONE[run.outcome]} className="capitalize">
          {run.outcome === "running" && <span className="size-1.5 animate-pulse rounded-full bg-current" />}
          {run.outcome}
        </Pill>
        <span className="rounded border px-1.5 py-px font-mono text-[11px] uppercase tracking-wide text-muted-foreground">{run.target}</span>
        <Who user={by} size={18} className="text-[13px]" />
        <RelativeTime date={run.started_at} className="text-[13px] text-muted-foreground" />
        <span className="ml-auto flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground tabular">
          <span>{formatDuration(duration)}</span>
          {sm.commands != null && <span>{sm.commands} cmd</span>}
          {sm.tmChecks != null && <span>{sm.tmChecks} tm</span>}
          {sm.prompts ? <span>{sm.prompts} prompt{sm.prompts === 1 ? "" : "s"}</span> : null}
          {sm.warnings ? <span className="text-tone-warn">{sm.warnings} warn</span> : null}
          {sm.errors ? <span className="text-tone-danger">{sm.errors} err</span> : null}
        </span>
      </button>
      {open && (
        <div className="border-t">
          {run.error && <p className="border-b bg-tone-danger/10 px-4 py-2 font-mono text-[12px] text-tone-danger">{run.error}</p>}
          {Object.keys(run.args ?? {}).length > 0 && (
            <p className="border-b px-4 py-2 font-mono text-[12px] text-muted-foreground">
              args: {Object.entries(run.args).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ")}
            </p>
          )}
          {detail.status === "loading" || detail.status === "idle" ? (
            <RunLogSkeleton />
          ) : detail.status === "error" ? (
            <p className="px-4 py-4 text-[13px] text-tone-danger">Couldn’t load the event log: {detail.error}</p>
          ) : (
            <RunLog events={events} />
          )}
        </div>
      )}
    </li>
  );
}
