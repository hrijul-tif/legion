"use client";

import { useEffect } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { MessageCircleQuestion } from "lucide-react";
import { useRunSession } from "./run-session";
import { Kbd } from "./ui";

function isTypingTarget(el: EventTarget | null): boolean {
  return (
    el instanceof HTMLElement &&
    !!el.closest(
      "input, textarea, select, [contenteditable='true'], .monaco-editor",
    )
  );
}

/**
 * The framework's operator prompt (the old CLI's inquirer menu). Sits above the console, not a modal:
 * the run is paused until a choice is made. Keys 1-9 pick a choice when no text field has focus.
 */
export function PromptBanner() {
  const { run, answer } = useRunSession();
  const prompt = run.prompt;
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!prompt) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target))
        return;
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= prompt.choices.length) {
        e.preventDefault();
        answer(prompt.choices[n - 1]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prompt, answer]);

  return (
    <AnimatePresence initial={false}>
      {prompt && (
        <motion.div
          key={prompt.id}
          role="alertdialog"
          aria-label="The procedure is waiting for your answer"
          initial={reduce ? false : { height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
          transition={{ type: "spring", stiffness: 420, damping: 38 }}
          className="shrink-0 overflow-hidden border-b border-tone-warn/40 bg-tone-warn/[0.09]"
        >
          <div className="flex gap-3 px-4 py-3">
            <span className="ide-pulse-warn mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-tone-warn/15 text-tone-warn">
              <MessageCircleQuestion className="size-4.5" />
            </span>
            <div className="min-w-0 flex-1 space-y-2.5">
              <div>
                <p className="text-[11px] font-semibold tracking-wider text-tone-warn uppercase">
                  The procedure is waiting for you
                </p>
                <p className="mt-1 max-h-28 overflow-y-auto text-[13px] leading-snug font-medium whitespace-pre-wrap break-words">
                  {prompt.message}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {prompt.choices.map((choice, i) => (
                  <button
                    key={`${i}-${choice}`}
                    type="button"
                    onClick={() => answer(choice)}
                    className="group inline-flex h-8 items-center gap-2 rounded-lg border border-tone-warn/35 bg-background/70 px-2.5 text-xs font-medium transition-all outline-none hover:border-tone-warn hover:bg-tone-warn/15 focus-visible:ring-3 focus-visible:ring-tone-warn/40 active:translate-y-px"
                  >
                    {i < 9 && (
                      <Kbd className="border-tone-warn/40 bg-tone-warn/10 text-tone-warn">
                        {i + 1}
                      </Kbd>
                    )}
                    <span>{choice.replace(/^\s*\d+\s*[:.)]\s*/, "")}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
