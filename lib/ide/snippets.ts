import type { Catalog, CatalogArg } from "../catalog/types";
import { detectAliases } from "../editor/catalog-analysis";

/** Usage snippets for the catalog panel, written against the aliases the file actually uses. */

export type ModuleKind = "commands" | "parameters";

export interface AliasChoice {
  alias: string;
  /** the file does not import the module yet: this line has to be added */
  importLine: string | null;
}

const DEFAULT_ALIAS: Record<ModuleKind, string> = {
  commands: "comm",
  parameters: "param",
};

/** Alias bound to framework.<mission>.<kind> in `source`, or the conventional one plus the import it needs. */
export function aliasFor(
  source: string,
  kind: ModuleKind,
  mission: Catalog["mission"],
): AliasChoice {
  const found: string[] = [];
  for (const [alias, info] of detectAliases(source)) {
    if (info.kind === kind && info.mission === mission && !alias.includes("."))
      found.push(alias);
  }
  if (found.length)
    return {
      alias: found.includes(DEFAULT_ALIAS[kind])
        ? DEFAULT_ALIAS[kind]
        : found[0],
      importLine: null,
    };
  return {
    alias: DEFAULT_ALIAS[kind],
    importLine: `import framework.${mission.toLowerCase()}.${kind} as ${DEFAULT_ALIAS[kind]}`,
  };
}

const PREFERRED_MEMBERS = ["ON", "ENABLE", "ENABLED"];

function pickMember(members: { name: string }[] | undefined): string | null {
  if (!members?.length) return null;
  return (members.find((m) => PREFERRED_MEMBERS.includes(m.name)) ?? members[0])
    .name;
}

function entryHasParam(source: string, name: string): boolean {
  return new RegExp(`def\\s+\\w+\\s*\\([^)]*\\b${name}\\s*:`).test(source);
}

function argPlaceholder(
  catalog: Catalog,
  arg: CatalogArg,
  alias: string,
  source: string,
): string {
  switch (arg.type) {
    case "enum": {
      if (arg.enum === "PusAckFlagsEnum") {
        if (entryHasParam(source, arg.name)) return arg.name;
        return `${alias}.PusAckFlagsEnum.ACCEPTANCE___COMPLETION`;
      }
      const member = pickMember(
        arg.enum ? catalog.enums[arg.enum]?.members : undefined,
      );
      return arg.enum && member ? `${alias}.${arg.enum}.${member}` : "None";
    }
    case "int":
      return typeof arg.default === "number" ? String(arg.default) : "0";
    case "float":
      return typeof arg.default === "number" ? String(arg.default) : "0.0";
    case "bool":
      return "False";
    case "str":
      return '""';
    case "datetime":
      return "create_utc_time()";
    case "list":
      return "[]";
    default:
      return "None";
  }
}

export interface Snippet {
  text: string;
  importLine: string | null;
}

/** `comm.<Cls>(Pus_Acknowledgement_Flags=Pus_Acknowledgement_Flags, <required args>).execute_await_completion()` */
export function commandSnippet(
  catalog: Catalog,
  className: string,
  source: string,
): Snippet | null {
  const cmd = catalog.commands[className];
  if (!cmd) return null;
  const { alias, importLine } = aliasFor(source, "commands", catalog.mission);
  const required = cmd.args.filter((a) => a.required);
  // flags first, as operators write them
  required.sort(
    (a, b) =>
      Number(b.enum === "PusAckFlagsEnum") -
      Number(a.enum === "PusAckFlagsEnum"),
  );
  const args = required
    .map((a) => `${a.name}=${argPlaceholder(catalog, a, alias, source)}`)
    .join(", ");
  return {
    text: `${alias}.${className}(${args}).execute_await_completion()`,
    importLine,
  };
}

function snake(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9_]/g, "_")
    .toLowerCase();
}

function uniqueName(base: string, source: string): string {
  let name = base || "value";
  let i = 2;
  while (new RegExp(`\\b${name}\\b`).test(source)) name = `${base}_${i++}`;
  return name;
}

/** `<var> = param.<Cls>().read_latest_parameter_value()` */
export function parameterSnippet(
  catalog: Catalog,
  className: string,
  source: string,
): Snippet | null {
  const p = catalog.parameters[className];
  if (!p) return null;
  const { alias, importLine } = aliasFor(source, "parameters", catalog.mission);
  const name = uniqueName(snake(p.field || className), source);
  return {
    text: `${name} = ${alias}.${className}().read_latest_parameter_value()`,
    importLine,
  };
}

/* ------------------------------------------------------------- insertion */

export interface TextEdit {
  /** 1-based, inclusive start; end exclusive (Monaco ranges) */
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  text: string;
}

const indentOf = (line: string) => /^[ \t]*/.exec(line)![0];
const isBlank = (line: string) => line.trim() === "";

/** Where an import line goes: after the last top-level import (0 = top of file). Returns the 1-based line to insert after. */
export function importInsertLine(lines: string[]): number {
  let last = 0;
  let depth = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (depth > 0) {
      depth += (l.match(/\(/g)?.length ?? 0) - (l.match(/\)/g)?.length ?? 0);
      if (depth <= 0) {
        depth = 0;
        last = i + 1;
      }
      continue;
    }
    if (/^(import|from)\s/.test(l)) {
      depth = Math.max(
        0,
        (l.match(/\(/g)?.length ?? 0) - (l.match(/\)/g)?.length ?? 0),
      );
      if (depth === 0) last = i + 1;
    } else if (/^(def|class|async\s+def)\s/.test(l)) break;
  }
  return last;
}

/**
 * Edits that put `snippet` on its own line near the cursor: a blank cursor line is filled in place,
 * otherwise the snippet goes on a new line below with the same indentation (one level deeper after a ':').
 * The import edit (if any) comes first and shifts the snippet by one line; apply them bottom-up.
 */
export function planInsertion(
  lines: string[],
  cursorLine: number,
  snippet: Snippet,
): { edits: TextEdit[]; insertedLine: number } {
  const lineText = lines[cursorLine - 1] ?? "";
  const edits: TextEdit[] = [];
  let insertedLine: number;

  if (isBlank(lineText)) {
    // indent like the nearest code above
    let indent = "";
    for (let i = cursorLine - 2; i >= 0; i--) {
      if (isBlank(lines[i])) continue;
      indent =
        indentOf(lines[i]) +
        (/:\s*(#.*)?$/.test(lines[i].trimEnd()) ? "    " : "");
      break;
    }
    if (!indent && lineText) indent = lineText;
    edits.push({
      startLine: cursorLine,
      startColumn: 1,
      endLine: cursorLine,
      endColumn: lineText.length + 1,
      text: indent + snippet.text,
    });
    insertedLine = cursorLine;
  } else {
    const indent =
      indentOf(lineText) +
      (/:\s*(#.*)?$/.test(lineText.trimEnd()) ? "    " : "");
    edits.push({
      startLine: cursorLine,
      startColumn: lineText.length + 1,
      endLine: cursorLine,
      endColumn: lineText.length + 1,
      text: `\n${indent}${snippet.text}`,
    });
    insertedLine = cursorLine + 1;
  }

  if (snippet.importLine) {
    const after = importInsertLine(lines);
    const text =
      after === 0 ? `${snippet.importLine}\n` : `\n${snippet.importLine}`;
    const col = after === 0 ? 1 : (lines[after - 1]?.length ?? 0) + 1;
    edits.push({
      startLine: Math.max(after, 1),
      startColumn: col,
      endLine: Math.max(after, 1),
      endColumn: col,
      text,
    });
    if (after <= cursorLine) insertedLine += 1;
  }
  // bottom-up so earlier edits keep their positions
  edits.sort(
    (a, b) => b.startLine - a.startLine || b.startColumn - a.startColumn,
  );
  return { edits, insertedLine };
}
