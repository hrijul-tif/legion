import { describe, expect, it } from "vitest";
import {
  defaultValues,
  listLiteral,
  reconcile,
  specsFromEntry,
  toRunArgs,
  validate,
  datetimeToIso,
  type ArgSpec,
} from "./args";
import { fixtureCatalog } from "../catalog/fixture";
import type { MosEntry } from "../editor/lang-protocol";

const entry: MosEntry = {
  entrypoint: "Proc",
  params: [
    {
      name: "Pus_Acknowledgement_Flags",
      annotation: "comm.PusAckFlagsEnum",
      kind: "enum",
      enum: "PusAckFlagsEnum",
      enumModule: "commands",
      position: "positional",
      required: true,
    },
    {
      name: "Threshold",
      annotation: "float",
      kind: "float",
      position: "positional",
      required: false,
      default: 3.2,
    },
    {
      name: "Count",
      annotation: "int",
      kind: "int",
      position: "positional",
      required: true,
    },
    {
      name: "Dry",
      annotation: "bool",
      kind: "bool",
      position: "keyword_only",
      required: false,
      default: true,
    },
    {
      name: "Ids",
      annotation: "list[int]",
      kind: "list",
      item: { kind: "int" },
      position: "positional",
      required: true,
    },
    {
      name: "Note",
      annotation: "str",
      kind: "str",
      position: "positional",
      required: false,
    },
    {
      name: "When",
      annotation: "datetime",
      kind: "datetime",
      position: "positional",
      required: true,
    },
  ],
};

describe("args form model", () => {
  const specs = specsFromEntry(entry, fixtureCatalog);

  it("resolves enum members from the catalog and preselects acceptance|completion", () => {
    expect(specs[0].members?.map((m) => m.name)).toContain(
      "ACCEPTANCE___COMPLETION",
    );
    const v = defaultValues(specs);
    expect(v.Pus_Acknowledgement_Flags).toBe("ACCEPTANCE___COMPLETION");
    expect(v.Threshold).toBe("3.2");
    expect(v.Dry).toBe(true);
    expect(v.Ids).toEqual([]);
  });

  it("validates required and typed fields", () => {
    const v = defaultValues(specs);
    const errors = validate(specs, {
      ...v,
      Count: "1.5",
      Ids: ["1", "x"],
      When: "",
    });
    expect(Object.keys(errors).sort()).toEqual(["Count", "Ids", "When"]);
    expect(
      validate(specs, {
        ...v,
        Count: "4",
        Ids: ["1", "2"],
        When: "2026-04-21T10:00",
      }),
    ).toEqual({});
  });

  it("serialises to what the run worker converts", () => {
    const v = {
      ...defaultValues(specs),
      Count: "4",
      Ids: ["1", "2"],
      When: "2026-04-21T10:00",
    };
    expect(toRunArgs(specs, v)).toEqual({
      Pus_Acknowledgement_Flags: "ACCEPTANCE___COMPLETION",
      Threshold: 3.2,
      Count: 4,
      Dry: true,
      Ids: "[1, 2]",
      When: "2026-04-21T10:00:00Z",
    });
  });

  it("omits optional blanks", () => {
    const v = {
      ...defaultValues(specs),
      Count: "1",
      Ids: [],
      When: "2026-04-21T10:00",
      Threshold: "",
    };
    const out = toRunArgs(specs, v);
    expect("Note" in out).toBe(false);
    expect("Threshold" in out).toBe(false);
  });

  it("reconcile keeps compatible remembered values only", () => {
    const next = reconcile(specs, {
      Count: "9",
      Dry: "oops" as unknown as boolean,
      Gone: "x",
    });
    expect(next.Count).toBe("9");
    expect(next.Dry).toBe(true);
    expect("Gone" in next).toBe(false);
  });
});

describe("literals", () => {
  it("builds python list literals", () => {
    expect(listLiteral(["1", "2"], "int")).toBe("[1, 2]");
    expect(listLiteral(["a", "it's"], "str")).toBe("['a', 'it\\'s']");
    expect(listLiteral(["1", "b"], "any")).toBe("[1, 'b']");
  });
  it("normalises datetime-local text", () => {
    expect(datetimeToIso("2026-04-21T10:00")).toBe("2026-04-21T10:00:00Z");
    expect(datetimeToIso("2026-04-21T10:00:30Z")).toBe("2026-04-21T10:00:30Z");
  });
  it("treats unspecified spec as blank-able", () => {
    const s: ArgSpec[] = [
      { name: "x", annotation: null, kind: "any", required: false },
    ];
    expect(toRunArgs(s, { x: "" })).toEqual({});
  });
});
