import type { Catalog } from "@/lib/catalog/types";
import type { MosEntry, MosParam } from "@/lib/editor/lang-protocol";
import type { SignatureResult } from "@/lib/sandbox/types";
import type { ProcedureSignature, SignatureParam } from "@/lib/data/types";

/** Argument form model: entry signature -> field specs -> typed values -> values the run worker converts. */

export type ArgKind =
  "str" | "int" | "float" | "bool" | "list" | "datetime" | "enum" | "any";
export type ItemKind = "str" | "int" | "float" | "bool" | "enum" | "any";

export interface ArgMember {
  name: string;
  value: string | number;
}

export interface ArgSpec {
  name: string;
  annotation: string | null;
  kind: ArgKind;
  required: boolean;
  enumName?: string;
  members?: ArgMember[];
  itemKind?: ItemKind;
  default?: unknown;
  defaultExpr?: string;
}

/** Form values: strings for text-like fields, booleans for switches, string chips for lists. */
export type ArgValue = string | boolean | string[];
export type ArgValues = Record<string, ArgValue>;

const PREFERRED_ACK = "ACCEPTANCE___COMPLETION";

function membersFor(
  catalog: Catalog | null,
  enumName: string | undefined,
  module?: "commands" | "parameters",
): ArgMember[] | undefined {
  if (!catalog || !enumName) return undefined;
  const order =
    module === "parameters"
      ? [catalog.paramEnums, catalog.enums]
      : [catalog.enums, catalog.paramEnums];
  for (const table of order)
    if (table[enumName]) return table[enumName].members;
  return undefined;
}

function itemKindOf(item: MosParam["item"]): ItemKind {
  switch (item?.kind) {
    case "str":
    case "int":
    case "float":
    case "bool":
    case "enum":
      return item.kind;
    default:
      return "any";
  }
}

/** Fields from the language service's parse of the entry function (live while typing). */
export function specsFromEntry(
  entry: MosEntry | null,
  catalog: Catalog | null,
): ArgSpec[] {
  if (!entry) return [];
  return entry.params.map((p) => {
    const kind: ArgKind = p.kind === "unknown" ? "any" : p.kind;
    const spec: ArgSpec = {
      name: p.name,
      annotation: p.annotation,
      kind,
      required: p.required,
      default: p.default,
      defaultExpr: p.defaultExpr,
    };
    if (kind === "enum") {
      spec.enumName = p.enum;
      spec.members = membersFor(catalog, p.enum, p.enumModule);
    }
    if (kind === "list") {
      spec.itemKind = itemKindOf(p.item);
      if (spec.itemKind === "enum") {
        spec.enumName = p.item?.enum;
        spec.members = membersFor(catalog, p.item?.enum, p.item?.enumModule);
      }
    }
    return spec;
  });
}

/** Fields from the run worker's static analysis (used where there is no editor, e.g. frozen snapshots). */
export function specsFromSignature(sig: SignatureResult): ArgSpec[] {
  return sig.params.map((p) => ({
    name: p.name,
    annotation: p.annotation,
    kind: p.kind,
    required: p.required,
    enumName: p.enum,
    members: p.members,
    itemKind: p.kind === "list" ? "any" : undefined,
    default: p.default,
    defaultExpr: p.defaultExpr,
  }));
}

/** What `submitSnapshot` stores: the contract operators fill in sheets against. */
export function signatureOf(entry: MosEntry): ProcedureSignature {
  const params: SignatureParam[] = entry.params.map((p) => {
    const out: SignatureParam = {
      name: p.name,
      annotation: p.annotation ?? "",
      kind: p.kind === "unknown" ? "any" : p.kind,
    };
    if (p.enum) out.enum = p.enum;
    if (p.default !== undefined) out.default = p.default;
    return out;
  });
  return { entrypoint: entry.entrypoint ?? "", params };
}

/* ---------------------------------------------------------------- defaults */

function memberFromDefault(spec: ArgSpec): ArgMember | undefined {
  const members = spec.members;
  if (!members?.length) return undefined;
  const d = spec.default;
  if (d !== undefined && d !== null) {
    const hit = members.find(
      (m) => m.value === d || String(m.value) === String(d) || m.name === d,
    );
    if (hit) return hit;
  }
  if (spec.defaultExpr) {
    const last = spec.defaultExpr.split(".").pop()?.trim();
    const hit = members.find((m) => m.name === last);
    if (hit) return hit;
  }
  return undefined;
}

export function defaultValue(spec: ArgSpec): ArgValue {
  switch (spec.kind) {
    case "bool":
      return typeof spec.default === "boolean" ? spec.default : false;
    case "int":
    case "float":
      return typeof spec.default === "number" ? String(spec.default) : "";
    case "str":
    case "any":
      return typeof spec.default === "string"
        ? spec.default
        : spec.default == null
          ? ""
          : String(spec.default);
    case "datetime":
      return typeof spec.default === "string"
        ? spec.default.replace(/Z$/, "").slice(0, 16)
        : "";
    case "list":
      return Array.isArray(spec.default)
        ? spec.default.map((x) => String(x))
        : [];
    case "enum": {
      const hit = memberFromDefault(spec);
      if (hit) return hit.name;
      const members = spec.members ?? [];
      if (!members.length) return "";
      if (spec.required)
        return (members.find((m) => m.name === PREFERRED_ACK) ?? members[0])
          .name;
      return "";
    }
  }
}

export function defaultValues(specs: ArgSpec[]): ArgValues {
  return Object.fromEntries(specs.map((s) => [s.name, defaultValue(s)]));
}

/** Keeps remembered values that still fit the (possibly edited) signature; everything else gets its default. */
export function reconcile(
  specs: ArgSpec[],
  saved: ArgValues | null | undefined,
  current?: ArgValues,
): ArgValues {
  const out: ArgValues = {};
  for (const s of specs) {
    const prior = current?.[s.name] ?? saved?.[s.name];
    out[s.name] =
      prior !== undefined && fits(s, prior) ? prior : defaultValue(s);
  }
  return out;
}

function fits(spec: ArgSpec, v: ArgValue): boolean {
  switch (spec.kind) {
    case "bool":
      return typeof v === "boolean";
    case "list":
      return Array.isArray(v);
    case "enum":
      return (
        typeof v === "string" &&
        (!spec.members?.length ||
          v === "" ||
          spec.members.some((m) => m.name === v))
      );
    default:
      return typeof v === "string";
  }
}

/* -------------------------------------------------------------- validation */

const INT_RE = /^[+-]?\d+$/;

export function isBlank(v: ArgValue | undefined): boolean {
  return v === undefined || (typeof v === "string" && v.trim() === "");
}

function validItem(kind: ItemKind, s: string): boolean {
  if (kind === "int") return INT_RE.test(s.trim());
  if (kind === "float") return s.trim() !== "" && Number.isFinite(Number(s));
  if (kind === "bool") return /^(true|false)$/i.test(s.trim());
  return true;
}

export function validate(
  specs: ArgSpec[],
  values: ArgValues,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const s of specs) {
    const v = values[s.name];
    if (s.kind === "bool") continue;
    if (s.kind === "list") {
      const items = Array.isArray(v) ? v : [];
      const bad = items.find((x) => !validItem(s.itemKind ?? "any", x));
      if (bad !== undefined)
        errors[s.name] = `"${bad}" is not a valid ${s.itemKind}`;
      continue;
    }
    if (isBlank(v)) {
      if (s.required)
        errors[s.name] = s.kind === "enum" ? "Choose a value" : "Required";
      continue;
    }
    const text = String(v).trim();
    if (s.kind === "int" && !INT_RE.test(text))
      errors[s.name] = "Enter a whole number";
    else if (s.kind === "float" && !Number.isFinite(Number(text)))
      errors[s.name] = "Enter a number";
    else if (
      s.kind === "datetime" &&
      Number.isNaN(
        Date.parse(
          text.length === 16
            ? `${text}:00Z`
            : text.endsWith("Z")
              ? text
              : `${text}Z`,
        ),
      )
    ) {
      errors[s.name] = "Enter a valid date and time";
    }
  }
  return errors;
}

/* ------------------------------------------------------------ serialisation */

function pyString(s: string): string {
  return `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

/** Python literal for a list of chip strings. */
export function listLiteral(
  items: string[],
  itemKind: ItemKind = "any",
): string {
  const parts = items.map((raw) => {
    const t = raw.trim();
    switch (itemKind) {
      case "int":
        return String(parseInt(t, 10));
      case "float":
        return String(Number(t));
      case "bool":
        return /^true$/i.test(t) ? "True" : "False";
      case "str":
      case "enum":
        return pyString(raw);
      default:
        // numbers stay numbers, anything else is a string
        return t !== "" && Number.isFinite(Number(t)) ? t : pyString(raw);
    }
  });
  return `[${parts.join(", ")}]`;
}

/** UTC wall-clock text from a datetime-local field -> ISO 8601 with a Z. */
export function datetimeToIso(local: string): string {
  const t = local.trim();
  if (t.endsWith("Z")) return t;
  return `${t.length === 16 ? `${t}:00` : t}Z`;
}

/** "YYYY-MM-DDTHH:mm" in UTC, `minutes` from `from`. */
export function utcLocalInput(from: Date, minutes = 0): string {
  return new Date(from.getTime() + minutes * 60_000).toISOString().slice(0, 16);
}

/** Values for the run request; optional blanks are omitted so the function's own defaults apply. */
export function toRunArgs(
  specs: ArgSpec[],
  values: ArgValues,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const s of specs) {
    const v = values[s.name];
    switch (s.kind) {
      case "bool":
        out[s.name] = v === true;
        break;
      case "list":
        if (
          !s.required &&
          Array.isArray(v) &&
          v.length === 0 &&
          s.default === undefined
        )
          break;
        out[s.name] = listLiteral(Array.isArray(v) ? v : [], s.itemKind);
        break;
      default: {
        if (isBlank(v)) {
          if (s.required && s.kind === "str") out[s.name] = "";
          break;
        }
        const text = String(v).trim();
        if (s.kind === "int") out[s.name] = parseInt(text, 10);
        else if (s.kind === "float") out[s.name] = Number(text);
        else if (s.kind === "datetime") out[s.name] = datetimeToIso(text);
        else if (s.kind === "str" || s.kind === "any") out[s.name] = String(v);
        else out[s.name] = text; // enum: member name
      }
    }
  }
  return out;
}

/** Short human text for an arg (run history, summaries). */
export function describeArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args);
  if (!entries.length) return "no arguments";
  return entries
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(", ");
}
