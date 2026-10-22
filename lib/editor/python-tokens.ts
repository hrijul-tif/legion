// A tiny, forgiving Python tokenizer: just enough structure (names, strings, operators, bracket
// pairing) for completion / hover / diagnostics. It never throws and tolerates half-typed code.

export interface Tok {
  t: 'name' | 'str' | 'num' | 'op';
  s: string;
  start: number;
  end: number;
  /** strings: content between the quotes (escapes untouched) */
  value?: string;
  contentStart?: number;
  contentEnd?: number;
  unterminated?: boolean;
  /** strings: has an f prefix (value is not a plain literal) */
  fstring?: boolean;
  /** true when a line break separates this token from the previous one */
  nl: boolean;
}

export interface Tokenized {
  tokens: Tok[];
  /** index of the matching bracket for every bracket token, else -1 */
  pair: Int32Array;
  /** index of the innermost opening bracket enclosing each token (-1 at top level) */
  enclosing: Int32Array;
}

const OPS3 = new Set(['**=', '//=', '>>=', '<<=', '...']);
const OPS2 = new Set(['**', '//', '==', '!=', '<=', '>=', '->', ':=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<', '>>', '@=']);
const STR_PREFIX = /^(?:[rRbBuUfF]|[rR][bBfF]|[bBfF][rR])$/;

function isIdStart(c: number): boolean {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c > 127;
}
function isIdPart(c: number): boolean {
  return isIdStart(c) || (c >= 48 && c <= 57);
}
function isDigit(c: number): boolean {
  return c >= 48 && c <= 57;
}

export function tokenize(src: string): Tokenized {
  const tokens: Tok[] = [];
  const n = src.length;
  let i = 0;
  let sawNl = true;

  const readString = (start: number, quotePos: number, prefix: string): number => {
    const q = src[quotePos];
    const triple = src.startsWith(q.repeat(3), quotePos);
    const openLen = triple ? 3 : 1;
    const contentStart = quotePos + openLen;
    let j = contentStart;
    let closed = false;
    while (j < n) {
      const ch = src[j];
      if (ch === '\\') {
        j += 2;
        continue;
      }
      if (triple) {
        if (src.startsWith(q.repeat(3), j)) {
          closed = true;
          break;
        }
      } else {
        if (ch === q) {
          closed = true;
          break;
        }
        if (ch === '\n') break;
      }
      j++;
    }
    if (j > n) j = n;
    const contentEnd = j;
    const end = closed ? j + openLen : j;
    tokens.push({
      t: 'str',
      s: src.slice(start, end),
      start,
      end,
      value: src.slice(contentStart, contentEnd),
      contentStart,
      contentEnd,
      unterminated: !closed,
      fstring: /[fF]/.test(prefix),
      nl: sawNl,
    });
    sawNl = false;
    return end;
  };

  while (i < n) {
    const c = src.charCodeAt(i);
    if (c === 10) {
      sawNl = true;
      i++;
      continue;
    }
    if (c === 32 || c === 9 || c === 13 || c === 12) {
      i++;
      continue;
    }
    if (c === 35) {
      while (i < n && src.charCodeAt(i) !== 10) i++;
      continue;
    }
    if (c === 92 && src.charCodeAt(i + 1) === 10) {
      // explicit line continuation
      i += 2;
      continue;
    }
    if (isIdStart(c)) {
      let j = i + 1;
      while (j < n && isIdPart(src.charCodeAt(j))) j++;
      const word = src.slice(i, j);
      if (j < n && (src[j] === '"' || src[j] === "'") && STR_PREFIX.test(word)) {
        i = readString(i, j, word);
        continue;
      }
      tokens.push({ t: 'name', s: word, start: i, end: j, nl: sawNl });
      sawNl = false;
      i = j;
      continue;
    }
    if (c === 34 || c === 39) {
      i = readString(i, i, '');
      continue;
    }
    if (isDigit(c) || (c === 46 && isDigit(src.charCodeAt(i + 1)))) {
      let j = i + 1;
      while (j < n) {
        const d = src.charCodeAt(j);
        if (isIdPart(d) || d === 46) j++;
        else if ((d === 43 || d === 45) && /[eE]/.test(src[j - 1]) && !/^0[xX]/.test(src.slice(i, j))) j++;
        else break;
      }
      tokens.push({ t: 'num', s: src.slice(i, j), start: i, end: j, nl: sawNl });
      sawNl = false;
      i = j;
      continue;
    }
    let op = src[i];
    if (OPS3.has(src.slice(i, i + 3))) op = src.slice(i, i + 3);
    else if (OPS2.has(src.slice(i, i + 2))) op = src.slice(i, i + 2);
    tokens.push({ t: 'op', s: op, start: i, end: i + op.length, nl: sawNl });
    sawNl = false;
    i += op.length;
  }

  // bracket pairing
  const m = tokens.length;
  const pair = new Int32Array(m).fill(-1);
  const enclosing = new Int32Array(m).fill(-1);
  const stack: number[] = [];
  const openerFor: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  for (let k = 0; k < m; k++) {
    const tk = tokens[k];
    if (tk.t === 'op' && (tk.s === '(' || tk.s === '[' || tk.s === '{')) {
      enclosing[k] = stack.length ? stack[stack.length - 1] : -1;
      stack.push(k);
    } else if (tk.t === 'op' && openerFor[tk.s]) {
      let p = stack.length - 1;
      while (p >= 0 && tokens[stack[p]].s !== openerFor[tk.s]) p--;
      if (p >= 0) {
        const o = stack[p];
        stack.length = p;
        pair[o] = k;
        pair[k] = o;
      }
      enclosing[k] = stack.length ? stack[stack.length - 1] : -1;
    } else {
      enclosing[k] = stack.length ? stack[stack.length - 1] : -1;
    }
  }
  return { tokens, pair, enclosing };
}
