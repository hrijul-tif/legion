/** Cheap structural outline of a procedure file (top-level functions and constants), no Python needed. */

export interface OutlineParam {
  name: string;
  annotation: string | null;
  default: string | null;
}

export interface OutlineFunction {
  name: string;
  line: number;
  params: OutlineParam[];
  isPrivate: boolean;
  isAsync: boolean;
}

export interface OutlineConstant {
  name: string;
  line: number;
  value: string;
}

export interface Outline {
  functions: OutlineFunction[];
  constants: OutlineConstant[];
}

function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      cur += ch;
      if (ch === "\\") cur += text[++i] ?? "";
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if ("([{".includes(ch)) {
      depth++;
      cur += ch;
    } else if (")]}".includes(ch)) {
      depth--;
      cur += ch;
    } else if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

function parseParam(raw: string): OutlineParam | null {
  if (raw === "*" || raw === "/") return null;
  const eq = (() => {
    let depth = 0;
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if ("([{".includes(c)) depth++;
      else if (")]}".includes(c)) depth--;
      else if (c === "=" && depth === 0) return i;
    }
    return -1;
  })();
  const head = (eq >= 0 ? raw.slice(0, eq) : raw).trim();
  const def = eq >= 0 ? raw.slice(eq + 1).trim() : null;
  const colon = head.indexOf(":");
  const name = (colon >= 0 ? head.slice(0, colon) : head)
    .trim()
    .replace(/^\*+/, "");
  if (!name) return null;
  return {
    name,
    annotation: colon >= 0 ? head.slice(colon + 1).trim() : null,
    default: def,
  };
}

export function parseOutline(source: string): Outline {
  const functions: OutlineFunction[] = [];
  const constants: OutlineConstant[] = [];
  const lineStarts = [0];
  for (let i = 0; i < source.length; i++)
    if (source.charCodeAt(i) === 10) lineStarts.push(i + 1);
  const lineOf = (offset: number) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  const defRe = /^(async[ \t]+)?def[ \t]+([A-Za-z_]\w*)[ \t]*\(/gm;
  for (let m = defRe.exec(source); m; m = defRe.exec(source)) {
    let depth = 1;
    let i = defRe.lastIndex;
    let quote: string | null = null;
    for (; i < source.length && depth > 0; i++) {
      const ch = source[i];
      if (quote) {
        if (ch === "\\") i++;
        else if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === "#") while (i < source.length && source[i] !== "\n") i++;
      else if (ch === "(") depth++;
      else if (ch === ")") depth--;
    }
    const inner = source.slice(defRe.lastIndex, i - 1).replace(/#[^\n]*/g, "");
    functions.push({
      name: m[2],
      line: lineOf(m.index),
      params: splitTopLevel(inner)
        .map(parseParam)
        .filter((p): p is OutlineParam => !!p),
      isPrivate: m[2].startsWith("_"),
      isAsync: !!m[1],
    });
  }

  const constRe = /^([A-Z][A-Z0-9_]*)[ \t]*(?::[^=\n]+)?=[ \t]*([^\n#]+)/gm;
  for (let m = constRe.exec(source); m; m = constRe.exec(source)) {
    constants.push({ name: m[1], line: lineOf(m.index), value: m[2].trim() });
  }
  return { functions, constants };
}
