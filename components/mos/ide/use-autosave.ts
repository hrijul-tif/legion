"use client";

import { useCallback, useEffect, useState } from "react";
import type * as Monaco from "monaco-editor";
import { saveDraft } from "@/app/actions/lifecycle";
import { SaveQueue, type SaveState } from "@/lib/ide/save-queue";
import {
  IDE_KEYS,
  LocalMirror,
  readJson,
  removeKey,
  type LocalDraft,
} from "@/lib/ide/storage";

interface Options {
  snapshotId: string;
  /** the draft as the server had it when the page loaded */
  serverCode: string;
  serverUpdatedAt: string;
  model: Monaco.editor.ITextModel | null;
  /** the editor to apply a restored local copy through (keeps undo history) */
  editor: Monaco.editor.IStandaloneCodeEditor | null;
  enabled: boolean;
}

export interface Autosave {
  state: SaveState;
  /** Saves now (awaits any in-flight save); resolves true when the server has the latest text. */
  flush(): Promise<boolean>;
  /** unsaved text from a previous session that is newer than the server copy */
  restorable: LocalDraft | null;
  restore(): void;
  discardLocal(): void;
  dirty(): boolean;
}

export function useAutosave({
  snapshotId,
  serverCode,
  serverUpdatedAt,
  model,
  editor,
  enabled,
}: Options): Autosave {
  const [state, setState] = useState<SaveState>({
    status: "saved",
    savedAt: Date.parse(serverUpdatedAt) || null,
    error: null,
    fatal: false,
  });
  const [restorable, setRestorable] = useState<LocalDraft | null>(null);

  const [queue] = useState(() => {
    const mirror = new LocalMirror(snapshotId);
    return new SaveQueue({
      initialSaved: serverCode,
      initialSavedAt: Date.parse(serverUpdatedAt) || null,
      save: async (code) => {
        const res = await saveDraft(snapshotId, code);
        return res.ok ? { ok: true } : { ok: false, error: res.error };
      },
      onState: setState,
      onLocal: (code) => mirror.write(code),
    });
  });

  // an older tab session may have left unsaved text behind
  useEffect(() => {
    if (!enabled) return;
    const local = readJson<LocalDraft>(IDE_KEYS.draft(snapshotId));
    if (!local) return;
    if (local.code === serverCode) {
      removeKey(IDE_KEYS.draft(snapshotId));
    } else if (local.at > (Date.parse(serverUpdatedAt) || 0)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is only readable after mount
      setRestorable(local);
    }
  }, [enabled, snapshotId, serverCode, serverUpdatedAt]);

  // every edit goes to the queue
  useEffect(() => {
    if (!model || !enabled) return;
    const sub = model.onDidChangeContent(() => queue.setCode(model.getValue()));
    return () => sub.dispose();
  }, [model, queue, enabled]);

  // leaving: push whatever is pending (the queue keeps retrying on its own if the network is down)
  useEffect(() => {
    return () => {
      if (queue.dirty) void queue.flush();
    };
  }, [queue]);

  useEffect(() => {
    if (!enabled) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (queue.dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [queue, enabled]);

  const restore = useCallback(() => {
    if (!restorable || !model) return;
    if (editor) {
      editor.executeEdits("mos-restore", [
        {
          range: model.getFullModelRange(),
          text: restorable.code,
          forceMoveMarkers: true,
        },
      ]);
      editor.pushUndoStop();
    } else model.setValue(restorable.code);
    setRestorable(null);
  }, [restorable, model, editor]);

  const discardLocal = useCallback(() => {
    removeKey(IDE_KEYS.draft(snapshotId));
    setRestorable(null);
  }, [snapshotId]);

  const flush = useCallback(() => queue.flush(), [queue]);
  const dirty = useCallback(() => queue.dirty, [queue]);

  return { state, flush, restorable, restore, discardLocal, dirty };
}
