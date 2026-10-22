import { describe, expect, it } from "vitest";
import { parseOutline } from "./outline";

const SRC = `import operator
MISSION = "FF1"
TIMEOUT: int = 10

def _helper(a, b: int = 2, *rest):
    return a

def Run_Proc(
    flags: comm.PusAckFlagsEnum,  # the flags
    ids: list[int] = [1, 2],
    note: str = "a, b",
):
    pass
`;

describe("parseOutline", () => {
  const o = parseOutline(SRC);
  it("lists functions with params, lines and privacy", () => {
    expect(o.functions.map((f) => [f.name, f.line, f.isPrivate])).toEqual([
      ["_helper", 5, true],
      ["Run_Proc", 8, false],
    ]);
    expect(o.functions[1].params).toEqual([
      { name: "flags", annotation: "comm.PusAckFlagsEnum", default: null },
      { name: "ids", annotation: "list[int]", default: "[1, 2]" },
      { name: "note", annotation: "str", default: '"a, b"' },
    ]);
    expect(o.functions[0].params.map((p) => p.name)).toEqual([
      "a",
      "b",
      "rest",
    ]);
  });
  it("lists upper-case constants", () => {
    expect(o.constants).toEqual([
      { name: "MISSION", line: 2, value: '"FF1"' },
      { name: "TIMEOUT", line: 3, value: "10" },
    ]);
  });
});
