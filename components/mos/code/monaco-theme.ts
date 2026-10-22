"use client";

import type * as Monaco from "monaco-editor";

/**
 * Builds the "mos-dark" / "mos-light" Monaco themes from the live CSS design tokens, so the editor always
 * matches the app palette. Monaco needs hex colours; the tokens are oklch, so each one is rasterised once
 * through a 1x1 canvas (which understands any CSS colour) and read back as sRGB.
 */

export type ThemeMode = "dark" | "light";
export const themeName = (mode: ThemeMode) => (mode === "light" ? "mos-light" : "mos-dark");

let ctx: CanvasRenderingContext2D | null = null;
function canvas(): CanvasRenderingContext2D {
  if (!ctx) {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    ctx = c.getContext("2d", { willReadFrequently: true })!;
  }
  return ctx;
}

type Rgb = [number, number, number];

function rasterise(css: string, over?: Rgb): Rgb {
  const c = canvas();
  c.clearRect(0, 0, 1, 1);
  if (over) {
    c.fillStyle = `rgb(${over[0]} ${over[1]} ${over[2]})`;
    c.fillRect(0, 0, 1, 1);
  }
  c.fillStyle = "#000";
  c.fillStyle = css;
  c.fillRect(0, 0, 1, 1);
  const d = c.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2]];
}

const hex2 = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
const toHex = (rgb: Rgb, alpha?: number) =>
  `#${hex2(rgb[0])}${hex2(rgb[1])}${hex2(rgb[2])}${alpha === undefined ? "" : hex2(alpha * 255)}`;

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function buildMosTheme(mode: ThemeMode): Monaco.editor.IStandaloneThemeData {
  const style = getComputedStyle(document.documentElement);
  const raw = (name: string) => style.getPropertyValue(name).trim() || "#888";
  const page = rasterise(raw("--background"));
  const card = rasterise(raw("--card"), page);
  const tok = (name: string, over: Rgb = card) => rasterise(raw(name), over);

  const fg = tok("--foreground");
  const muted = tok("--muted-foreground");
  const border = tok("--border");
  const accent = tok("--accent");
  const primary = tok("--primary");
  const popover = tok("--popover", page);
  const t = {
    info: tok("--tone-info"),
    progress: tok("--tone-progress"),
    warn: tok("--tone-warn"),
    success: tok("--tone-success"),
    danger: tok("--tone-danger"),
    muted: tok("--tone-muted"),
  };
  const dim = mix(muted, card, 0.35);
  const h = (c: Rgb, a?: number) => toHex(c, a);

  return {
    base: mode === "dark" ? "vs-dark" : "vs",
    inherit: true,
    rules: [
      { token: "", foreground: h(fg).slice(1) },
      { token: "comment", foreground: h(muted).slice(1), fontStyle: "italic" },
      { token: "keyword", foreground: h(t.progress).slice(1) },
      { token: "keyword.flow", foreground: h(t.progress).slice(1) },
      { token: "string", foreground: h(t.success).slice(1) },
      { token: "string.escape", foreground: h(t.warn).slice(1) },
      { token: "number", foreground: h(t.warn).slice(1) },
      { token: "number.float", foreground: h(t.warn).slice(1) },
      { token: "constant", foreground: h(t.warn).slice(1) },
      { token: "type", foreground: h(t.info).slice(1) },
      { token: "type.identifier", foreground: h(t.info).slice(1) },
      { token: "predefined", foreground: h(t.info).slice(1) },
      { token: "tag", foreground: h(t.warn).slice(1) },
      { token: "annotation", foreground: h(t.warn).slice(1) },
      { token: "identifier", foreground: h(fg).slice(1) },
      { token: "operator", foreground: h(mix(fg, muted, 0.5)).slice(1) },
      { token: "delimiter", foreground: h(mix(fg, muted, 0.5)).slice(1) },
    ],
    colors: {
      "editor.background": h(card),
      "editor.foreground": h(fg),
      "editorGutter.background": h(card),
      "editorLineNumber.foreground": h(dim),
      "editorLineNumber.activeForeground": h(fg),
      "editor.lineHighlightBackground": h(accent, 0.45),
      "editor.lineHighlightBorder": "#00000000",
      "editor.selectionBackground": h(primary, 0.28),
      "editor.inactiveSelectionBackground": h(primary, 0.16),
      "editor.selectionHighlightBackground": h(primary, 0.14),
      "editor.wordHighlightBackground": h(primary, 0.14),
      "editor.findMatchBackground": h(t.warn, 0.4),
      "editor.findMatchHighlightBackground": h(t.warn, 0.2),
      "editorCursor.foreground": h(primary),
      "editorIndentGuide.background1": h(border, 0.7),
      "editorIndentGuide.activeBackground1": h(dim),
      "editorBracketMatch.background": h(primary, 0.18),
      "editorBracketMatch.border": h(primary, 0.5),
      "editorWhitespace.foreground": h(border),
      "editorRuler.foreground": h(border),
      "editorWidget.background": h(popover),
      "editorWidget.border": h(border),
      "editorWidget.foreground": h(fg),
      "editorHoverWidget.background": h(popover),
      "editorHoverWidget.border": h(border),
      "editorHoverWidget.foreground": h(fg),
      "editorSuggestWidget.background": h(popover),
      "editorSuggestWidget.border": h(border),
      "editorSuggestWidget.selectedBackground": h(accent),
      "editorStickyScroll.background": h(mix(card, page, 0.5)),
      "editorStickyScrollHover.background": h(accent),
      "editorStickyScroll.border": h(border),
      "editorStickyScroll.shadow": "#00000000",
      "editorOverviewRuler.border": "#00000000",
      "editorError.foreground": h(t.danger),
      "editorWarning.foreground": h(t.warn),
      "editorInfo.foreground": h(t.info),
      "scrollbarSlider.background": h(muted, 0.18),
      "scrollbarSlider.hoverBackground": h(muted, 0.32),
      "scrollbarSlider.activeBackground": h(muted, 0.45),
      "foldingBackground": h(accent, 0.3),
      "input.background": h(page),
      "input.border": h(border),
      "focusBorder": h(primary, 0.6),
      "list.hoverBackground": h(accent, 0.6),
      "list.activeSelectionBackground": h(accent),
      "list.activeSelectionForeground": h(fg),
      "list.focusBackground": h(accent),
      "menu.background": h(popover),
      "menu.selectionBackground": h(accent),
      "menu.foreground": h(fg),
      "menu.separatorBackground": h(border),
      // diff editor
      "diffEditor.insertedTextBackground": h(t.success, 0.2),
      "diffEditor.removedTextBackground": h(t.danger, 0.2),
      "diffEditor.insertedLineBackground": h(t.success, 0.09),
      "diffEditor.removedLineBackground": h(t.danger, 0.09),
      "diffEditorGutter.insertedLineBackground": h(t.success, 0.16),
      "diffEditorGutter.removedLineBackground": h(t.danger, 0.16),
      "diffEditor.diagonalFill": h(border, 0.5),
      "diffEditor.border": h(border),
      "diffEditor.unchangedRegionBackground": h(mix(card, page, 0.6)),
      "diffEditor.unchangedRegionForeground": h(muted),
      "diffEditor.unchangedRegionShadow": "#00000000",
      "diffEditor.unchangedCodeBackground": h(accent, 0.1),
      "diffEditorOverview.insertedForeground": h(t.success, 0.5),
      "diffEditorOverview.removedForeground": h(t.danger, 0.5),
    },
  };
}

/** Define (or redefine) the mos theme for a mode and make it current. Safe to call repeatedly. */
export function applyMosTheme(monaco: typeof Monaco, mode: ThemeMode): void {
  monaco.editor.defineTheme(themeName(mode), buildMosTheme(mode));
  monaco.editor.setTheme(themeName(mode));
}

/** The editor font stack: Geist Mono as loaded by next/font, with sane fallbacks. */
export function monoFontFamily(): string {
  const v = typeof document === "undefined" ? "" : getComputedStyle(document.documentElement).getPropertyValue("--font-geist-mono").trim();
  return `${v ? v + ", " : ""}ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
}
