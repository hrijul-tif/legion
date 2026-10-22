"use client";

import { useEffect, useState } from "react";
import type { EditorApi } from "./editor-pane";
import {
  collectProblems,
  subscribeEntry,
  type EntryState,
  type Problem,
} from "@/lib/ide/monaco-ide";

/** Live problems (Ruff + MOS + catalog markers) of the editor's model. */
export function useProblems(api: EditorApi | null): Problem[] {
  const [problems, setProblems] = useState<Problem[]>([]);
  useEffect(() => {
    if (!api) return;
    const { monaco, model } = api;
    let raf = 0;
    const refresh = () => {
      raf = 0;
      if (!model.isDisposed()) setProblems(collectProblems(monaco, model));
    };
    refresh();
    const sub = monaco.editor.onDidChangeMarkers((uris) => {
      if (raf || !uris.some((u) => u.toString() === model.uri.toString()))
        return;
      raf = requestAnimationFrame(refresh);
    });
    return () => {
      sub.dispose();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [api]);
  return problems;
}

const NO_ENTRY: EntryState = { entry: null, diagnostics: [], checked: false };

/** Entry-function signature as parsed by the language service on the latest check. */
export function useEntry(api: EditorApi | null): EntryState {
  const [state, setState] = useState<EntryState>(NO_ENTRY);
  useEffect(() => {
    if (!api) return;
    return subscribeEntry(api.monaco, api.model, setState);
  }, [api]);
  return state;
}
