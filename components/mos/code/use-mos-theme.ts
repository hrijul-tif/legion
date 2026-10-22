"use client";

import { useEffect } from "react";
import { useMonaco } from "@monaco-editor/react";
import { useTheme } from "next-themes";
import type * as Monaco from "monaco-editor";
import "./monaco-loader";
import { applyMosTheme, themeName, type ThemeMode } from "./monaco-theme";

/** Keeps Monaco's theme in sync with next-themes. `beforeMount` defines the theme before the first paint. */
export function useMosTheme(): { theme: string; mode: ThemeMode; beforeMount: (monaco: typeof Monaco) => void } {
  const { resolvedTheme } = useTheme();
  const mode: ThemeMode = resolvedTheme === "light" ? "light" : "dark";
  const monaco = useMonaco();

  useEffect(() => {
    if (!monaco) return;
    // next-themes flips the <html> class in an effect that runs after ours; wait a frame so the tokens are current.
    const raf = requestAnimationFrame(() => applyMosTheme(monaco, mode));
    return () => cancelAnimationFrame(raf);
  }, [monaco, mode]);

  return { theme: themeName(mode), mode, beforeMount: (m) => applyMosTheme(m, mode) };
}
