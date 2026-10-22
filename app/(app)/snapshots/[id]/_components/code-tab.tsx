"use client";

import { useMemo, useState } from "react";
import { Download, FileCode2, WrapText } from "lucide-react";
import { toast } from "sonner";
import { CodeViewer, type CommentMarker } from "@/components/mos/code/code-viewer";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { SnapshotPageData } from "@/lib/data/snapshot";
import { countLines, formatBytes } from "./derive";
import { CopyButton, EmptyNote } from "./bits";

export function commentMarkers(data: SnapshotPageData): CommentMarker[] {
  const byLine = new Map<number, { count: number; open: number }>();
  for (const c of data.comments) {
    if (c.line == null) continue;
    const e = byLine.get(c.line) ?? { count: 0, open: 0 };
    e.count++;
    if (!c.resolved_at) e.open++;
    byLine.set(c.line, e);
  }
  return [...byLine].map(([line, e]) => ({ line, count: e.count, resolved: e.open === 0 })).sort((a, b) => a.line - b.line);
}

export function CodeTab({ data, onJumpToLine }: { data: SnapshotPageData; onJumpToLine: (line: number) => void }) {
  const { snapshot: s, procedure: p } = data;
  const [wrap, setWrap] = useState(false);
  const markers = useMemo(() => commentMarkers(data), [data]);
  const lines = countLines(data.code);
  const bytes = s.code_bytes ?? new Blob([data.code]).size;
  const sig = s.signature;

  if (data.codeError) {
    return (
      <EmptyNote icon={<FileCode2 />} title="The code couldn’t be loaded">
        {data.codeError}
      </EmptyNote>
    );
  }

  const download = () => {
    const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "procedure";
    const name = `${slug}_${s.number}${s.code_sha256 ? "_" + s.code_sha256.slice(0, 7) : "_draft"}.py`;
    const url = URL.createObjectURL(new Blob([data.code], { type: "text/x-python" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Downloaded ${name}`);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px]">
          {sig ? (
            <code className="min-w-0 truncate rounded-md border bg-card px-2.5 py-1 font-mono text-[12.5px]" title={`${sig.entrypoint}(${sig.params.map((x) => x.name + ": " + x.annotation).join(", ")})`}>
              <span className="text-tone-info">{sig.entrypoint}</span>
              <span className="text-muted-foreground">(</span>
              {sig.params.map((param, i) => (
                <span key={param.name}>
                  {i > 0 && <span className="text-muted-foreground">, </span>}
                  <span>{param.name}</span>
                  <span className="text-muted-foreground">: </span>
                  <span className="text-tone-progress">{param.annotation}</span>
                  {param.default !== undefined && <span className="text-muted-foreground"> = {JSON.stringify(param.default)}</span>}
                </span>
              ))}
              <span className="text-muted-foreground">)</span>
            </code>
          ) : s.entrypoint ? (
            <code className="rounded-md border bg-card px-2.5 py-1 font-mono text-[12.5px] text-tone-info">{s.entrypoint}()</code>
          ) : (
            <span className="text-muted-foreground">Entry point is captured when the snapshot is submitted</span>
          )}
          <span className="tabular text-muted-foreground">
            {lines} lines · {formatBytes(bytes)}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Toggle size="sm" pressed={wrap} onPressedChange={setWrap} aria-label="Toggle word wrap" variant="outline">
                <WrapText /> Wrap
              </Toggle>
            </TooltipTrigger>
            <TooltipContent>Word wrap</TooltipContent>
          </Tooltip>
          <CopyButton text={data.code} label="Copy code" className="size-7" />
          <Button variant="outline" size="sm" onClick={download}>
            <Download /> .py
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card" style={{ height: `clamp(260px, ${lines * 21 + 48}px, 78dvh)` }}>
        <CodeViewer
          code={data.code}
          path={`mos/snapshots/${s.id}.py`}
          mission={p.mission}
          wordWrap={wrap}
          markers={markers}
          onMarkerClick={onJumpToLine}
        />
      </div>
      {markers.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Speech bubbles in the gutter mark lines with review comments — click one to jump to it in the Review tab.
        </p>
      )}
    </div>
  );
}
