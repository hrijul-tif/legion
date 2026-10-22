import { describe, expect, it } from "vitest";
import { fixtureCatalog } from "../catalog/fixture";
import {
  aliasFor,
  commandSnippet,
  importInsertLine,
  parameterSnippet,
  planInsertion,
} from "./snippets";

const SRC = `import operator
import framework.ff.commands as cmd
import framework.ff.parameters as tm
from framework.utils.log_helper import run_logger as logger


def Proc(Pus_Acknowledgement_Flags: cmd.PusAckFlagsEnum):
    logger.info("hi")
`;

describe("snippets", () => {
  it("uses the aliases of the file", () => {
    expect(aliasFor(SRC, "commands", "FF")).toEqual({
      alias: "cmd",
      importLine: null,
    });
    expect(aliasFor(SRC, "parameters", "FF").alias).toBe("tm");
    expect(aliasFor("", "commands", "FF").importLine).toBe(
      "import framework.ff.commands as comm",
    );
  });

  it("builds a command call with the ack flags variable and required args", () => {
    const s = commandSnippet(fixtureCatalog, "EPSSwtAocs3v3BkMn", SRC)!;
    expect(s.text).toBe(
      "cmd.EPSSwtAocs3v3BkMn(Pus_Acknowledgement_Flags=Pus_Acknowledgement_Flags, On_Off_State=cmd.NullConfigOnoffEnum.ON).execute_await_completion()",
    );
    const bare = commandSnippet(fixtureCatalog, "EPSSwtAocs3v3BkMn", "")!;
    expect(bare.text).toContain("comm.PusAckFlagsEnum.ACCEPTANCE___COMPLETION");
    expect(bare.importLine).toBeTruthy();
  });

  it("builds a parameter read with a fresh variable name", () => {
    const s = parameterSnippet(fixtureCatalog, "EPSBatteryVoltage", SRC)!;
    expect(s.text).toMatch(
      /^\w+ = tm\.EPSBatteryVoltage\(\)\.read_latest_parameter_value\(\)$/,
    );
  });

  it("finds the import block", () => {
    expect(importInsertLine(SRC.split("\n"))).toBe(4);
    expect(importInsertLine(["def x():", "  pass"])).toBe(0);
    expect(importInsertLine(["from a import (", "  b,", ")", "x = 1"])).toBe(3);
  });

  it("inserts below a code line with the same indent, deeper after a colon", () => {
    const lines = SRC.split("\n");
    const { edits, insertedLine } = planInsertion(lines, 7, {
      text: "foo()",
      importLine: null,
    });
    expect(edits).toHaveLength(1);
    expect(edits[0].text).toBe("\n    foo()");
    expect(insertedLine).toBe(8);
  });

  it("fills a blank line in place", () => {
    const lines = ["def f():", "    a = 1", ""];
    const { edits } = planInsertion(lines, 3, {
      text: "foo()",
      importLine: null,
    });
    expect(edits[0]).toMatchObject({
      startLine: 3,
      startColumn: 1,
      endColumn: 1,
      text: "    foo()",
    });
  });

  it("adds a missing import on top, bottom-up ordered", () => {
    const lines = ["def f():", "    a = 1"];
    const { edits } = planInsertion(lines, 2, {
      text: "x()",
      importLine: "import framework.ff.commands as comm",
    });
    expect(edits).toHaveLength(2);
    expect(edits[0].startLine).toBeGreaterThanOrEqual(edits[1].startLine);
  });
});
