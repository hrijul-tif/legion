"use client";

import { useMountedWhileVisible } from "./use-mounted-while-visible";

import { useEffect, useImperativeHandle, useMemo, useRef, type Ref } from "react";
import type * as Monaco from "monaco-editor";
import { MonacoEditor } from "./monaco-lazy";
import { useMosTheme } from "./use-mos-theme";
import { bindModelToMission } from "./monaco-setup";
import { monoFontFamily } from "./monaco-theme";
import { cn } from "@/lib/utils";

export interface CommentMarker {
  line: number;
  count: number;
  /** true when every comment on the line is resolved */
  resolved: boolean;
}

export interface CodeViewerHandle {
  revealLine(line: number): void;
}

export interface CodeViewerProps {
  code: string;
  /** Stable, unique model path (e.g. `mos/snapshots/<id>.py`). */
  path: string;
  mission: "FF" | "JTYU";
  wordWrap?: boolean;
  fontSize?: number;
  /** Gutter speech-bubble markers (review comments). */
  markers?: CommentMarker[];
  onMarkerClick?: (line: number) => void;
  /** Line to scroll to and softly highlight. */
  focusLine?: number | null;
  handleRef?: Ref<CodeViewerHandle>;
  className?: string;
}

/** Read-only Python viewer: no minimap, folding, sticky scroll, Geist Mono 13px, catalog hovers for comm.X / param.Y. */
function CodeViewerInner({
  code,
  path,
  mission,
  wordWrap = false,
  fontSize = 13,
  markers,
  onMarkerClick,
  focusLine,
  handleRef,
  className,
}: CodeViewerProps) {
  const { theme, beforeMount } = useMosTheme();
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const markerCollection = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null);
  const focusCollection = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null);
  const markerLines = useRef(new Map<number, CommentMarker>());
  const onMarkerClickRef = useRef(onMarkerClick);
  const readyRef = useRef(false);

  useEffect(() => {
    onMarkerClickRef.current = onMarkerClick;
  }, [onMarkerClick]);

  useImperativeHandle(handleRef, () => ({
    revealLine(line: number) {
      editorRef.current?.revealLineInCenter(line);
    },
  }));

  const applyMarkers = (list: CommentMarker[] | undefined) => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    markerLines.current = new Map((list ?? []).map((m) => [m.line, m]));
    const decorations: Monaco.editor.IModelDeltaDecoration[] = (list ?? []).map((m) => ({
      range: new monaco.Range(m.line, 1, m.line, 1),
      options: {
        glyphMarginClassName: `mos-glyph mos-glyph-comment ${m.resolved ? "mos-glyph-resolved" : "mos-glyph-open"}`,
        glyphMarginHoverMessage: {
          value: `${m.count} review comment${m.count === 1 ? "" : "s"}${m.resolved ? " (resolved)" : ""} — click to open in Review`,
        },
      },
    }));
    markerCollection.current?.set(decorations);
  };

  const applyFocus = (line: number | null | undefined) => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    if (!line) {
      focusCollection.current?.clear();
      return;
    }
    focusCollection.current?.set([
      {
        range: new monaco.Range(line, 1, line, 1),
        options: { isWholeLine: true, className: "mos-line-focus", linesDecorationsClassName: "mos-line-focus-gutter" },
      },
    ]);
    editor.revealLineInCenterIfOutsideViewport(line);
  };

  // Marker and focus props can change after mount.
  useEffect(() => {
    if (readyRef.current) applyMarkers(markers);
  }, [markers]);
  useEffect(() => {
    if (readyRef.current) applyFocus(focusLine);
  }, [focusLine]);

  const hasMarkers = !!markers?.length;
  const options = useMemo<Monaco.editor.IStandaloneEditorConstructionOptions>(
    () => ({
      readOnly: true,
      domReadOnly: true,
      minimap: { enabled: false },
      lineNumbers: "on",
      folding: true,
      showFoldingControls: "mouseover",
      stickyScroll: { enabled: true },
      glyphMargin: hasMarkers,
      fontFamily: monoFontFamily(),
      fontSize,
      lineHeight: Math.round(fontSize * 1.6),
      fontLigatures: false,
      wordWrap: wordWrap ? "on" : "off",
      scrollBeyondLastLine: false,
      automaticLayout: true,
      renderLineHighlight: "line",
      padding: { top: 12, bottom: 12 },
      smoothScrolling: true,
      bracketPairColorization: { enabled: true },
      guides: { indentation: true, bracketPairs: false },
      overviewRulerBorder: false,
      hideCursorInOverviewRuler: true,
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false },
      fixedOverflowWidgets: true,
      contextmenu: true,
      renderWhitespace: "none",
      tabSize: 4,
      accessibilitySupport: "auto",
      ariaLabel: "Procedure source code (read-only)",
    }),
    [hasMarkers, fontSize, wordWrap],
  );

  return (
    <div className={cn("h-full min-h-0 w-full overflow-hidden", className)}>
      <MonacoEditor
        path={path}
        language="python"
        value={code}
        theme={theme}
        beforeMount={beforeMount}
        onMount={(editor, monaco) => {
          editorRef.current = editor;
          monacoRef.current = monaco;
          readyRef.current = true;
          markerCollection.current = editor.createDecorationsCollection();
          focusCollection.current = editor.createDecorationsCollection();
          const model = editor.getModel();
          if (model) {
            const unbind = bindModelToMission(monaco, model, mission);
            editor.onDidDispose(unbind);
          }
          editor.onMouseDown((e) => {
            if (e.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;
            const line = e.target.position?.lineNumber;
            if (line && markerLines.current.has(line)) onMarkerClickRef.current?.(line);
          });
          void document.fonts?.ready.then(() => monaco.editor.remeasureFonts());
          applyMarkers(markers);
          applyFocus(focusLine);
        }}
        options={options}
      />
    </div>
  );
}

/** Mounted only while its route is visible (see useMountedWhileVisible). */
export function CodeViewer(props: CodeViewerProps) {
  const alive = useMountedWhileVisible();
  return alive ? <CodeViewerInner {...props} /> : null;
}
