// Cheap "did you mean" matching over a few thousand identifiers.

/** Levenshtein distance, giving up (returning max+1) once it must exceed `max`. */
export function boundedLevenshtein(a: string, b: string, max: number): number {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  let prev = new Array<number>(lb + 1);
  let cur = new Array<number>(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    cur[0] = i;
    let rowMin = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= lb; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    const t = prev;
    prev = cur;
    cur = t;
  }
  return prev[lb];
}

/** Up to `limit` candidates closest to `name` (case-insensitive), best first. */
export function closestNames(name: string, pool: Iterable<string>, limit = 3): string[] {
  const needle = name.toLowerCase();
  if (!needle) return [];
  const max = Math.max(2, Math.floor(needle.length * 0.35));
  const scored: { name: string; score: number }[] = [];
  for (const cand of pool) {
    if (cand === name) continue;
    const lc = cand.toLowerCase();
    let score = boundedLevenshtein(needle, lc, max);
    if (needle.length >= 4 && (lc.includes(needle) || needle.includes(lc))) {
      score = Math.min(score, 1 + Math.abs(lc.length - needle.length) / 100);
    } else if (score > max && needle.length >= 4 && lc.startsWith(needle.slice(0, Math.min(needle.length, 6)))) {
      score = max + 0.5;
    }
    if (score <= max + 0.5) scored.push({ name: cand, score });
  }
  scored.sort((x, y) => x.score - y.score || x.name.length - y.name.length || (x.name < y.name ? -1 : 1));
  return scored.slice(0, limit).map((s) => s.name);
}
