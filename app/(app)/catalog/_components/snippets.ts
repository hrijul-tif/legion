import type { Catalog, CatalogArg, CatalogEnum } from "@/lib/catalog/types";

const PREFERRED_MEMBERS = ["ON", "ENABLE", "ENABLED"];

function pickMember(e: CatalogEnum | undefined): string | null {
  if (!e || e.members.length === 0) return null;
  return (e.members.find((m) => PREFERRED_MEMBERS.includes(m.name)) ?? e.members[0]).name;
}

function argValue(catalog: Catalog, arg: CatalogArg): string {
  switch (arg.type) {
    case "enum": {
      // The ack-flags enum is conventionally prepared once as a variable named after the argument.
      if (arg.enum === "PusAckFlagsEnum") return arg.name;
      const member = pickMember(arg.enum ? catalog.enums[arg.enum] : undefined);
      return arg.enum && member ? `comm.${arg.enum}.${member}` : "None";
    }
    case "int":
      return "0";
    case "float":
      return "0.0";
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

/** One-line call with the required arguments filled with sensible placeholders. */
export function commandSnippet(catalog: Catalog, className: string): string {
  const cmd = catalog.commands[className];
  if (!cmd) return "";
  const required = cmd.args.filter((a) => a.required);
  // Flags first, as operators usually write them.
  required.sort((a, b) => Number(b.enum === "PusAckFlagsEnum") - Number(a.enum === "PusAckFlagsEnum"));
  const args = required.map((a) => `${a.name}=${argValue(catalog, a)}`).join(", ");
  return `comm.${className}(${args}).execute_await_completion()`;
}

export function parameterSnippet(catalog: Catalog, className: string): string {
  const p = catalog.parameters[className];
  if (!p) return "";
  let expected: string;
  switch (p.type) {
    case "enum": {
      const member = pickMember(p.enum ? catalog.paramEnums[p.enum] : undefined);
      expected = p.enum && member ? `param.${p.enum}.${member}.value` : "None";
      break;
    }
    case "int":
      expected = "0";
      break;
    case "float":
      expected = "0.0";
      break;
    case "bool":
      expected = "True";
      break;
    case "str":
      expected = '""';
      break;
    default:
      expected = "None";
  }
  return `param.${className}().read_parameter_until(${expected}, operator.eq, timeout=10)`;
}
