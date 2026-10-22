import { describe, expect, it } from "vitest";
import { fixtureCatalog } from "../catalog/fixture";
import { referencedCommands, referencedParameters } from "./refs";

const SRC = `import framework.ff.commands as c
import framework.ff.parameters as p

def Proc(flags: c.PusAckFlagsEnum):
    v = p.EPSBatteryVoltage().read_latest_parameter_value()  # p.Bogus
    w = p.EPSBatteryVoltage().read_fresh_parameter_value()
    c.EPSSwtAocs3v3BkMn(Pus_Acknowledgement_Flags=flags, On_Off_State=c.NullConfigOnoffEnum.ON).execute_await_completion()
`;

describe("referenced items", () => {
  it("finds unique parameters through the file's aliases, with first line", () => {
    expect(referencedParameters(SRC, fixtureCatalog)).toEqual([
      { name: "EPSBatteryVoltage", q: "/FF/EPS/Battery_Voltage", line: 5 },
    ]);
  });
  it("finds commands and ignores enums and unknown names", () => {
    expect(referencedCommands(SRC, fixtureCatalog).map((r) => r.name)).toEqual([
      "EPSSwtAocs3v3BkMn",
    ]);
  });
});
