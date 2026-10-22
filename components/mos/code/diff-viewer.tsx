"use client";

import { useMountedWhileVisible } from "./use-mounted-while-visible";

import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import type * as Monaco from "monaco-editor";
import { MonacoDiffEditor } from "./monaco-lazy";
import { useMosTheme } from "./use-mos-theme";
import { bindModelToMission } from "./monaco-setup";
import { monoFontFamily } from "./monaco-theme";
import type { CommentMarker } from "./code-viewer";
import { cn } from "@/lib/utils";

/** React content rendered in a Monaco view zone, anchored under a line of the modified (right) side. */
export interface ZoneSpec {
  key: string;
  afterLine: number;
  node: ReactNode;
}

export interface DiffViewerHandle {
  revealLine(line: number): void;
}

export interface DiffViewerProps {
  original: string;
  modified: string;
  /** Unique, stable id used to name the two models (e.g. the snapshot id). */
  modelKey: string;
  mission: "FF" | "JTYU";
  sideBySide?: boolean;
  hideUnchanged?: boolean;
  wordWrap?: boolean;
  zones?: ZoneSpec[];
  markers?: CommentMarker[];
  /** When true, hovering a gutter line shows a "+" and clicking it calls onRequestComment. */
  canComment?: boolean;
  onRequestComment?: (line: number) => void;
  focusLine?: number | null;
  handleRef?: Ref<DiffViewerHandle>;
  className?: string;
}

const GUTTER_TYPES = (monaco: typeof Monaco) => [
  monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN,
  monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS,
  monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS,
];

/* ---------------------------------------------------------------- view zones */

interface LiveZone {
  id: string;
  dom: HTMLElement;
  after: number;
  zone: Monaco.editor.IViewZone;
}

function ZoneBox({ onHeight, children }: { onHeight: (h: number) => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const report = () => onHeight(Math.ceil(el.getBoundingClientRect().height));
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [onHeight]);
  return <div ref={ref}>{children}</div>;
}

/** Mounts React nodes into Monaco view zones and keeps each zone exactly as tall as its content. */
function useViewZones(editor: Monaco.editor.ICodeEditor | null, zones: ZoneSpec[]): ReactNode[] {
  const live = useRef(new Map<string, LiveZone>());
  const [doms, setDoms] = useState<Record<string, HTMLElement>>({});
  const signature = zones.map((z) => `${z.key}@${z.afterLine}`).join("|");
  const wanted = useRef(zones);
  useEffect(() => {
    wanted.current = zones;
  });

  const setHeight = useCallback(
    (key: string, h: number) => {
      const z = live.current.get(key);
      if (!editor || !z || !h || z.zone.heightInPx === h) return;
      z.zone.heightInPx = h;
      editor.changeViewZones((acc) => acc.layoutZone(z.id));
    },
    [editor],
  );

  useEffect(() => {
    if (!editor) return;
    const want = new Map(wanted.current.map((z) => [z.key, z]));
    editor.changeViewZones((acc) => {
      for (const [key, z] of live.current) {
        const w = want.get(key);
        if (!w || w.afterLine !== z.after) {
          acc.removeZone(z.id);
          live.current.delete(key);
        }
      }
      for (const [key, w] of want) {
        if (live.current.has(key)) continue;
        const dom = document.createElement("div");
        dom.className = "mos-zone";
        const zone: Monaco.editor.IViewZone = { afterLineNumber: w.afterLine, heightInPx: 56, domNode: dom, suppressMouseDown: true };
        const id = acc.addZone(zone);
        live.current.set(key, { id, dom, after: w.afterLine, zone });
      }
    });
    setDoms(Object.fromEntries([...live.current].map(([k, z]) => [k, z.dom])));
  }, [editor, signature]);

  useEffect(() => {
    const zonesRef = live.current;
    return () => {
      if (!editor) return;
      try {
        editor.changeViewZones((acc) => zonesRef.forEach((z) => acc.removeZone(z.id)));
      } catch {
        /* editor already disposed */
      }
      zonesRef.clear();
    };
  }, [editor]);

  return zones.map((z) => {
    const dom = doms[z.key];
    return dom
      ? createPortal(
          <ZoneBox onHeight={(h) => setHeight(z.key, h)}>{z.node}</ZoneBox>,
          dom,
          z.key,
        )
      : null;
  });
}

/* --------------------------------------------------------------------- viewer */

function DiffViewerInner({
  original,
  modified,
  modelKey,
  mission,
  sideBySide = true,
  hideUnchanged = true,
  wordWrap = false,
  zones = [],
  markers,
  canComment = false,
  onRequestComment,
  focusLine,
  handleRef,
  className,
}: DiffViewerProps) {
  const { theme, beforeMount } = useMosTheme();
  // Unique per mount, so a remount can never pick up (and then lose) models the previous instance is disposing.
  const instance = useId().replace(/[^a-z0-9]/gi, "");
  const [diffEditor, setDiffEditor] = useState<Monaco.editor.IStandaloneDiffEditor | null>(null);
  const [modifiedEditor, setModifiedEditor] = useState<Monaco.editor.ICodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const decorations = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null);
  const hoverLine = useRef(0);
  const markerMap = useRef(new Map<number, CommentMarker>());
  const requestRef = useRef(onRequestComment);
  const canCommentRef = useRef(canComment);
  const focusCollection = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null);
  const modelsRef = useRef<{ original: Monaco.editor.ITextModel; modified: Monaco.editor.ITextModel } | null>(null);

  // @monaco-editor/react disposes the models before the widget on unmount, which Monaco reports as an
  // uncaught error. We keep the models alive through its teardown and dispose them right after.
  useEffect(
    () => () => {
      const models = modelsRef.current;
      modelsRef.current = null;
      setTimeout(() => {
        models?.original.dispose();
        models?.modified.dispose();
      }, 0);
    },
    [],
  );

  useEffect(() => {
    requestRef.current = onRequestComment;
    canCommentRef.current = canComment;
  });

  useImperativeHandle(handleRef, () => ({
    revealLine(line: number) {
      modifiedEditor?.revealLineInCenter(line);
    },
  }));

  const paintDecorations = useCallback(() => {
    const monaco = monacoRef.current;
    const coll = decorations.current;
    if (!monaco || !coll) return;
    const out: Monaco.editor.IModelDeltaDecoration[] = [];
    for (const m of markerMap.current.values()) {
      out.push({
        range: new monaco.Range(m.line, 1, m.line, 1),
        options: {
          glyphMarginClassName: `mos-glyph mos-glyph-comment ${m.resolved ? "mos-glyph-resolved" : "mos-glyph-open"}`,
          glyphMarginHoverMessage: { value: `${m.count} comment${m.count === 1 ? "" : "s"} — click to add another` },
        },
      });
    }
    const h = hoverLine.current;
    if (h && canCommentRef.current && !markerMap.current.has(h)) {
      out.push({
        range: new monaco.Range(h, 1, h, 1),
        options: { glyphMarginClassName: "mos-glyph mos-glyph-add", glyphMarginHoverMessage: { value: "Add a review comment on this line" } },
      });
    }
    coll.set(out);
  }, []);

  useEffect(() => {
    markerMap.current = new Map((markers ?? []).map((m) => [m.line, m]));
    paintDecorations();
  }, [markers, paintDecorations, modifiedEditor]);

  useEffect(() => {
    if (!modifiedEditor || !monacoRef.current) return;
    const monaco = monacoRef.current;
    if (!focusLine) {
      focusCollection.current?.clear();
      return;
    }
    focusCollection.current ??= modifiedEditor.createDecorationsCollection();
    focusCollection.current.set([
      {
        range: new monaco.Range(focusLine, 1, focusLine, 1),
        options: { isWholeLine: true, className: "mos-line-focus", linesDecorationsClassName: "mos-line-focus-gutter" },
      },
    ]);
    modifiedEditor.revealLineInCenterIfOutsideViewport(focusLine);
  }, [focusLine, modifiedEditor]);

  const portals = useViewZones(modifiedEditor, zones);

  const options = useMemo<Monaco.editor.IDiffEditorConstructionOptions>(
    () => ({
      readOnly: true,
      originalEditable: false,
      renderSideBySide: sideBySide,
      useInlineViewWhenSpaceIsLimited: false,
      hideUnchangedRegions: { enabled: hideUnchanged, revealLineCount: 4, minimumLineCount: 5, contextLineCount: 3 },
      ignoreTrimWhitespace: false,
      renderIndicators: true,
      renderOverviewRuler: true,
      enableSplitViewResizing: true,
      diffAlgorithm: "advanced",
      minimap: { enabled: false },
      glyphMargin: true,
      folding: false,
      fontFamily: monoFontFamily(),
      fontSize: 13,
      lineHeight: 20,
      wordWrap: wordWrap ? "on" : "off",
      diffWordWrap: wordWrap ? "on" : "off",
      scrollBeyondLastLine: false,
      automaticLayout: true,
      padding: { top: 8, bottom: 8 },
      smoothScrolling: true,
      overviewRulerBorder: false,
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false },
      fixedOverflowWidgets: true,
      renderWhitespace: "none",
      ariaLabel: "Diff of procedure source code (read-only)",
    }),
    [sideBySide, hideUnchanged, wordWrap],
  );

  return (
    <div className={cn("h-full min-h-0 w-full overflow-hidden", className)}>
      <MonacoDiffEditor
        original={original}
        modified={modified}
        language="python"
        originalModelPath={`mos/diff/${modelKey}/${instance}/original.py`}
        modifiedModelPath={`mos/diff/${modelKey}/${instance}/modified.py`}
        keepCurrentOriginalModel
        keepCurrentModifiedModel
        theme={theme}
        beforeMount={beforeMount}
        options={options}
        onMount={(editor, monaco) => {
          monacoRef.current = monaco;
          modelsRef.current = editor.getModel();
          const mod = editor.getModifiedEditor();
          editor.getOriginalEditor().updateOptions({ glyphMargin: false });
          decorations.current = mod.createDecorationsCollection();
          const model = mod.getModel();
          if (model) {
            const unbind = bindModelToMission(monaco, model, mission);
            mod.onDidDispose(unbind);
          }
          const gutter = GUTTER_TYPES(monaco);
          mod.onMouseMove((e) => {
            const over = gutter.includes(e.target.type) ? (e.target.position?.lineNumber ?? 0) : 0;
            if (over !== hoverLine.current) {
              hoverLine.current = over;
              paintDecorations();
            }
          });
          mod.onMouseLeave(() => {
            hoverLine.current = 0;
            paintDecorations();
          });
          mod.onMouseDown((e) => {
            if (!canCommentRef.current || !gutter.includes(e.target.type)) return;
            const line = e.target.position?.lineNumber;
            if (line) requestRef.current?.(line);
          });
          mod.addAction({
            id: "mos.addReviewComment",
            label: "Add review comment on this line",
            contextMenuGroupId: "navigation",
            contextMenuOrder: 0,
            precondition: undefined,
            run: (ed) => {
              const line = ed.getPosition()?.lineNumber;
              if (line && canCommentRef.current) requestRef.current?.(line);
            },
          });
          void document.fonts?.ready.then(() => monaco.editor.remeasureFonts());
          setDiffEditor(editor);
          setModifiedEditor(mod);
          paintDecorations();
        }}
      />
      {/* view-zone contents render here (portals into Monaco's DOM) */}
      {diffEditor ? portals : null}
    </div>
  );
}

/** Mounted only while its route is visible (see useMountedWhileVisible). */
export function DiffViewer(props: DiffViewerProps) {
  const alive = useMountedWhileVisible();
  return alive ? <DiffViewerInner {...props} /> : null;
}
