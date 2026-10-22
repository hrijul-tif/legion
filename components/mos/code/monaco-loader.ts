"use client";

import { loader } from "@monaco-editor/react";

/**
 * Monaco is served same-origin from /vendor/monaco/vs (the app runs cross-origin isolated, so no CDN).
 * Importing this module configures the loader once; every Monaco wrapper imports it first.
 */
export const MONACO_VS_PATH = "/vendor/monaco/vs";

let configured = false;
export function configureMonacoLoader(): void {
  if (configured || typeof window === "undefined") return;
  configured = true;
  loader.config({ paths: { vs: MONACO_VS_PATH } });
}

configureMonacoLoader();

// @monaco-editor/react cancels its loader promise when an editor unmounts before Monaco finishes loading
// (fast navigation, Activity hide). That cancellation is expected; keep it out of the console and dev overlay.
if (typeof window !== "undefined") {
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason as { type?: string } | undefined;
    if (r && typeof r === "object" && r.type === "cancelation") e.preventDefault();
  });
}
