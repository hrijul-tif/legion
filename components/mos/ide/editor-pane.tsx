"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import type * as Monaco from "monaco-editor";
import {
  MonacoDiffEditor,
  MonacoEditor,
} from "@/components/mos/code/monaco-lazy";
import { useMosTheme } from "@/components/mos/code/use-mos-theme";
import { monoFontFamily } from "@/components/mos/code/monaco-theme";
import {
  attachModel,
  cancelModelDisposal,
  scheduleModelDisposal,
} from "@/lib/ide/monaco-ide";
import { useMountedWhileVisible } from "./ui";
import type { Mission } from "@/lib/data/types";
import "./ide.css";

export interface EditorApi {
  monaco: typeof Monaco;
  /** the editable editor (the modified side while comparing) */
  editor: Monaco.editor.IStandaloneCodeEditor;
  model: Monaco.editor.ITextModel;
}

export interface EditorCommands {
  run(): void;
  stop(): void;
  save(): void;
}

export interface EditorPaneProps {
  /** unique model path for this working copy (stable for the lifetime of the page) */
  modelPath: string;
  initialCode: string;
  mission: Mission;
  /** present => diff view (original = `code`, read-only) */
  compare: { code: string; key: string } | null;
  sideBySide: boolean;
  hideUnchanged: boolean;
  readOnly?: boolean;
  onReady(api: EditorApi): void;
  onCursor(pos: { line: number; column: number }): void;
  commands: EditorCommands;
}

const PLACEHOLDER =
  "Start from the template, or press ⌘/Ctrl+Space — insert commands and parameters from the TM/TC catalog on the left.";

function baseOptions(
  readOnly: boolean,
): Monaco.editor.IStandaloneEditorConstructionOptions {
  return {
    readOnly,
    minimap: {
      enabled: true,
      size: "proportional",
      renderCharacters: false,
      maxColumn: 70,
      scale: 1,
      showSlider: "mouseover",
    },
    stickyScroll: { enabled: true },
    bracketPairColorization: { enabled: true },
    guides: { indentation: true, bracketPairs: "active" },
    fontFamily: monoFontFamily(),
    fontSize: 13.5,
    lineHeight: 22,
    fontLigatures: false,
    fixedOverflowWidgets: true,
    automaticLayout: true,
    tabSize: 4,
    insertSpaces: true,
    detectIndentation: false,
    scrollBeyondLastLine: false,
    smoothScrolling: true,
    cursorSmoothCaretAnimation: "on",
    cursorBlinking: "smooth",
    padding: { top: 12, bottom: 12 },
    renderLineHighlight: "all",
    overviewRulerBorder: false,
    scrollbar: {
      verticalScrollbarSize: 10,
      horizontalScrollbarSize: 10,
      useShadows: false,
    },
    renderWhitespace: "selection",
    dropIntoEditor: { enabled: true },
    quickSuggestions: { other: true, comments: false, strings: true },
    suggest: { preview: true, showStatusBar: true },
    placeholder: PLACEHOLDER,
    ariaLabel: "Procedure source code",
    folding: true,
    showFoldingControls: "mouseover",
    lineNumbersMinChars: 3,
    glyphMargin: false,
    accessibilitySupport: "auto",
  };
}

export function EditorPane({
  modelPath,
  initialCode,
  mission,
  compare,
  sideBySide,
  hideUnchanged,
  readOnly = false,
  onReady,
  onCursor,
  commands,
}: EditorPaneProps) {
  const { theme, beforeMount } = useMosTheme();
  const alive = useMountedWhileVisible();
  const monacoRef = useRef<typeof Monaco | null>(null);
  const commandsRef = useRef(commands);
  const readyRef = useRef(onReady);
  const cursorRef = useRef(onCursor);
  useEffect(() => {
    commandsRef.current = commands;
    readyRef.current = onReady;
    cursorRef.current = onCursor;
  });

  // keep the model alive while the editor is swapped (editor <-> diff) or the route is hidden; free it on real exit
  useEffect(() => {
    cancelModelDisposal(modelPath);
    return () => {
      const monaco = monacoRef.current;
      if (monaco) scheduleModelDisposal(monaco, modelPath);
    };
  }, [modelPath]);

  const setup = useCallback(
    (editor: Monaco.editor.IStandaloneCodeEditor, monaco: typeof Monaco) => {
      monacoRef.current = monaco;
      const model = editor.getModel();
      if (!model) return;
      cancelModelDisposal(modelPath);
      const detach = attachModel(monaco, model, mission);
      model.onWillDispose(detach);
      const K = monaco.KeyMod;
      const C = monaco.KeyCode;
      editor.addCommand(K.CtrlCmd | C.Enter, () => commandsRef.current.run());
      editor.addCommand(K.CtrlCmd | C.KeyS, () => commandsRef.current.save());
      editor.addCommand(K.CtrlCmd | C.Period, () => commandsRef.current.stop());
      editor.onDidChangeCursorPosition((e) =>
        cursorRef.current({
          line: e.position.lineNumber,
          column: e.position.column,
        }),
      );
      const pos = editor.getPosition();
      if (pos) cursorRef.current({ line: pos.lineNumber, column: pos.column });
      void document.fonts?.ready.then(() => monaco.editor.remeasureFonts());
      readyRef.current({ monaco, editor, model });
    },
    [modelPath, mission],
  );

  const options = useMemo(() => baseOptions(readOnly), [readOnly]);
  const diffOptions = useMemo<Monaco.editor.IDiffEditorConstructionOptions>(
    () => ({
      ...baseOptions(readOnly),
      originalEditable: false,
      renderSideBySide: sideBySide,
      useInlineViewWhenSpaceIsLimited: false,
      hideUnchangedRegions: {
        enabled: hideUnchanged,
        revealLineCount: 4,
        minimumLineCount: 5,
        contextLineCount: 3,
      },
      renderIndicators: true,
      renderOverviewRuler: true,
      enableSplitViewResizing: true,
      diffAlgorithm: "advanced",
      minimap: { enabled: false },
      stickyScroll: { enabled: false },
      glyphMargin: false,
    }),
    [readOnly, sideBySide, hideUnchanged],
  );

  return (
    <div className="h-full min-h-0 w-full overflow-hidden">
      {!alive ? null : compare ? (
        <MonacoDiffEditor
          original={compare.code}
          modified={initialCode}
          originalModelPath={`${modelPath}.base-${compare.key}`}
          modifiedModelPath={modelPath}
          keepCurrentModifiedModel
          language="python"
          theme={theme}
          beforeMount={beforeMount}
          options={diffOptions}
          onMount={(diff, monaco) => setup(diff.getModifiedEditor(), monaco)}
        />
      ) : (
        <MonacoEditor
          path={modelPath}
          defaultValue={initialCode}
          keepCurrentModel
          language="python"
          theme={theme}
          beforeMount={beforeMount}
          options={options}
          onMount={setup}
        />
      )}
    </div>
  );
}
