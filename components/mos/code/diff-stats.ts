import { diffLines } from "diff";

export interface DiffStats {
  added: number;
  removed: number;
  /** 1-based line numbers in the NEW text that were added or modified. */
  changedNewLines: number[];
}

function countLines(value: string): number {
  if (!value) return 0;
  const n = value.split("\n").length;
  return value.endsWith("\n") ? n - 1 : n;
}

/** Line-level +/- counts between two texts, plus where the changes land in the new text. */
export function lineDiffStats(oldText: string, newText: string): DiffStats {
  let added = 0;
  let removed = 0;
  let newLine = 1;
  const changedNewLines: number[] = [];
  for (const part of diffLines(oldText, newText)) {
    const n = countLines(part.value);
    if (part.added) {
      added += n;
      for (let i = 0; i < n; i++) changedNewLines.push(newLine + i);
      newLine += n;
    } else if (part.removed) {
      removed += n;
    } else {
      newLine += n;
    }
  }
  return { added, removed, changedNewLines };
}
