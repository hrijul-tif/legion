import { describe, expect, it } from "vitest";
import type { Catalog } from "@/lib/catalog/types";
import { commandSnippet, parameterSnippet } from "./snippets";

const catalog: Catalog = {
  mission: "FF",
  source: "test",
  generatedAt: "2026-01-01T00:00:00Z",
  enums: {
    NullConfigOnoffEnum: { members: [{ name: "OFF", value: "Off" }, { name: "ON", value: "On" }] },
    PusAckFlagsEnum: { members: [{ name: "ACCEPTANCE", value: "Acceptance" }] },
  },
  paramEnums: { AocsModeEnum: { members: [{ name: "RATE_DAMP", value: "Rate_Damp" }, { name: "FINE_POINTING", value: "Fine_Pointing" }] } },
  commands: {
    EPSSwtAocs3v3BkMn: {
      q: "/FF/EPS/Swt_aocs3v3BkMn",
      subsystem: "EPS",
      args: [
        { name: "On_Off_State", wire: "On_Off_State", type: "enum", enum: "NullConfigOnoffEnum", required: true },
        { name: "Pus_Acknowledgement_Flags", wire: "Pus_Acknowledgement_Flags", type: "enum", enum: "PusAckFlagsEnum", required: true },
        { name: "Command_Timetag", wire: "Command_Timetag", type: "datetime", required: false, default: "1970-01-01T00:00:00.000000Z" },
      ],
      fixed: {},
    },
  },
  parameters: {
    AOCSAocsMode: { q: "/FF/AOCS/Aocs_Mode", subsystem: "AOCS", kind: "enumeration", field: "Aocs_Mode", type: "enum", enum: "AocsModeEnum" },
    EPSBatteryVoltage: { q: "/FF/EPS/Battery_Voltage", subsystem: "EPS", kind: "normal", field: "Battery_Voltage", type: "float" },
  },
};

describe("catalog snippets", () => {
  it("builds a command call with required args only", () => {
    expect(commandSnippet(catalog, "EPSSwtAocs3v3BkMn")).toBe(
      "comm.EPSSwtAocs3v3BkMn(Pus_Acknowledgement_Flags=Pus_Acknowledgement_Flags, On_Off_State=comm.NullConfigOnoffEnum.ON).execute_await_completion()",
    );
  });
  it("builds a parameter wait", () => {
    expect(parameterSnippet(catalog, "EPSBatteryVoltage")).toBe("param.EPSBatteryVoltage().read_parameter_until(0.0, operator.eq, timeout=10)");
    expect(parameterSnippet(catalog, "AOCSAocsMode")).toBe("param.AOCSAocsMode().read_parameter_until(param.AocsModeEnum.RATE_DAMP.value, operator.eq, timeout=10)");
  });
});
