"use client";

import dynamic from "next/dynamic";
import "./monaco-loader";
import "./monaco.css";
import { Skeleton } from "@/components/ui/skeleton";

function EditorSkeleton() {
  return (
    <div className="flex h-full min-h-48 w-full flex-col gap-2 p-4" aria-busy="true" aria-label="Loading editor">
      {Array.from({ length: 14 }).map((_, i) => (
        <Skeleton key={i} className="h-3.5" style={{ width: `${30 + ((i * 37) % 55)}%` }} />
      ))}
    </div>
  );
}

/** Monaco never renders on the server: it is imported on the client only. */
export const MonacoEditor = dynamic(() => import("@monaco-editor/react").then((m) => m.Editor), {
  ssr: false,
  loading: () => <EditorSkeleton />,
});

export const MonacoDiffEditor = dynamic(() => import("@monaco-editor/react").then((m) => m.DiffEditor), {
  ssr: false,
  loading: () => <EditorSkeleton />,
});
