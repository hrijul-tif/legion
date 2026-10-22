"use client";

import { useLayoutEffect, useState } from "react";

/**
 * With cacheComponents, Next keeps hidden routes mounted inside React <Activity>; on re-show,
 * @monaco-editor/react touches its disposed editor and crashes. Unmount Monaco while hidden, remount fresh.
 */
export function useMountedWhileVisible(): boolean {
  const [alive, setAlive] = useState(true);
  useLayoutEffect(() => {
    queueMicrotask(() => setAlive(true));
    return () => setAlive(false);
  }, []);
  return alive;
}
