/**
 * The demo data: 20 real FF procedures (copied from ff-procedures/ops/procedures, see seed/procedures/ff) and the
 * history each one went through. `scripts/seed.ts` replays this against Supabase; `scripts/test-seeds.ts` replays it
 * offline and runs every snapshot on the mock spacecraft.
 *
 * Times are relative ("41d 20h" = 41 days 20 hours before the seed runs) so the demo always looks current:
 * a snapshot that has been in review for 9 days is still 9 days old whenever you seed.
 *
 * Storylines covered (see the report in the PR / README of the seed agent):
 *   EPS_181   superseded -> approved chain, two authors' working copies forked from the active snapshot
 *   FSW_04    rollback incident: #3 approved, anomaly, #2 reactivated (rollback), #3 withdrawn
 *   FSW_55    review failure with line comments, fixed in the next snapshot
 *   FSW_40    test failure, retest, pass
 *   FSW_45    approval refused, sent back for retest (in test now)
 *   EPS_313   retired with an approved snapshot;   EPS_147 retired then restored (past)
 *   PAY_251   never approved (review failed + a working copy);   PRP_22 stale in review (9d);   SYS_02 stale in test (6d)
 */
import type { ProcedureSeed } from "./types";

const ACK = "Acceptance | Completion";
const TT = "2030-01-01T00:00:00Z";

const p = (
  name: string,
  folder: string,
  description: string,
  defaultArgs: ProcedureSeed["defaultArgs"],
  history: ProcedureSeed["history"],
): ProcedureSeed => ({ name, mission: "FF", folder, description, file: `procedures/ff/${folder}/${name}.py`, defaultArgs, history });

export const PROCEDURES: ProcedureSeed[] = [
  /* ------------------------------------------------------------------------------------------------ EPS */
  p(
    "FF_AXX_FCP_EPS_181_Set_solar_panel_string_3_shunt_threshold",
    "EPS/FCP",
    "Sets the shunt threshold voltage of solar panel string 3. Reads the threshold table, sets the new value (up to three attempts) and confirms it on telemetry.",
    { Pus_Acknowledgement_Flags: ACK, Threshold: 3.2 },
    [
      { op: "create", by: "asha", ago: "42d 3h", code: "v1" },
      { op: "submit", n: 1, ago: "41d 20h", summary: "First version: read the thresholds, set string 3, read back and compare." },
      { op: "create", by: "asha", ago: "41d 19h", from: 1, code: "main" },
      {
        op: "comment", n: 1, by: "meera", ago: "41d 4h",
        body: "The read-back compares a rounded float with ==. Works for 0.1 V steps, but say so in a comment.",
        anchor: { text: "if current == Threshold" },
        resolved: { by: "meera", ago: "41d 1h" },
      },
      { op: "review_pass", n: 1, by: "meera", ago: "40d 22h", comment: "Fine for a first version." },
      { op: "test", n: 1, by: "kabir", ago: "40d 2h", name: "Set 3.0 V -> 3.2 V on the nominal mock", result: "pass", notes: "Threshold read back as 3.2 after the Set.", run: {} },
      { op: "test_pass", n: 1, by: "kabir", ago: "40d 1h", comment: "Nominal case passes." },
      { op: "approve", n: 1, by: "nisha", ago: "39d 3h" },
      // #2 goes through review after the retry loop was added
      {
        op: "submit", n: 2, ago: "20d 5h",
        summary: "Retry the Set up to 3 times. The first Set is sometimes dropped while the OBC is busy with a TM dump (seen on passes 1103 and 1111).",
      },
      { op: "create", by: "asha", ago: "20d 4h", from: 2, code: "v3" },
      {
        op: "comment", n: 2, by: "meera", ago: "19d 23h",
        body: "Is 3 attempts enough? On pass 1111 it needed two retries.",
        anchor: { text: "max_attempts = 3" },
        resolved: { by: "meera", ago: "19d 22h" },
      },
      { op: "comment", n: 2, by: "meera", ago: "19d 22h", body: "Later: make the attempt count an argument so ops can raise it without a new snapshot." },
      { op: "review_pass", n: 2, by: "meera", ago: "19d 20h" },
      { op: "test", n: 2, by: "kabir", ago: "19d 1h", name: "Set 3.0 V -> 3.2 V, nominal", result: "pass", notes: "Same as #1; the retry loop is not entered.", run: {} },
      {
        op: "test", n: 2, by: "kabir", ago: "19d 0h 40m", name: "First Set fails, retry succeeds", result: "pass",
        notes: "Injected command_fails once on the Set; chose Retry at the prompt; threshold ended at 3.2.",
        run: { faults: [{ kind: "command_fails", match: "Set_slrPnl3", once: true }], answers: ["1: Retry command"] },
      },
      { op: "test_pass", n: 2, by: "kabir", ago: "18d 22h" },
      { op: "approve", n: 2, by: "nisha", ago: "17d 3h", comment: "Approved. #1 is superseded." },
      // working copies of two authors, forked from the active snapshot
      { op: "create", by: "rohan", ago: "3d 6h", from: 2, code: "v4" },
      { op: "run", n: 3, by: "asha", ago: "2d 3h" },
    ],
  ),
  p(
    "FF_AXX_FCP_EPS_313_Reboot_SBT2",
    "EPS/FCP",
    "Reboots S-band transmitter 2 through the EPS (EPS Reboot_Sbt command with Sbt = SBT_2).",
    { Pus_Acknowledgement_Flags: ACK },
    [
      { op: "create", by: "rohan", ago: "55d", code: "main" },
      { op: "submit", n: 1, ago: "54d 22h", summary: "Reboot SBT-2 through the EPS reboot command." },
      { op: "review_pass", n: 1, by: "meera", ago: "54d 3h" },
      { op: "test", n: 1, by: "kabir", ago: "53d 22h", name: "Reboot command accepted and completed", result: "pass", notes: "Completed in 0.5 s on the mock.", run: {} },
      { op: "test_pass", n: 1, by: "kabir", ago: "53d 21h" },
      { op: "approve", n: 1, by: "nisha", ago: "53d 2h" },
      {
        op: "retire", by: "nisha", ago: "14d 3h",
        reason: "Replaced by the FSW-side SBT reboot sequence. The EPS reboot command is not enabled on the flight model, so this must not be used.",
      },
    ],
  ),
  p(
    "FF_AXX_CRP_EPS_201_Set_OBC_01_main_switch_OFF",
    "EPS/CRP",
    "Switches the OBC-1 main power switch off and checks the switch state on telemetry. Reads the OBDH 5 V current afterwards.",
    { Pus_Acknowledgement_Flags: ACK },
    [
      { op: "create", by: "asha", ago: "66d 2h", code: "main" },
      { op: "submit", n: 1, ago: "65d 21h", summary: "Switch the OBC-1 main switch OFF and verify the switch state." },
      {
        op: "comment", n: 1, by: "meera", ago: "65d 5h",
        body: "Add the OBDH current read to the run log? It is read but never used.",
        anchor: { text: "EPSObdh5vMnHpCur" },
        resolved: { by: "meera", ago: "65d 3h" },
      },
      { op: "review_pass", n: 1, by: "meera", ago: "65d 2h" },
      { op: "test", n: 1, by: "kabir", ago: "64d 22h", name: "OBC-1 main switch ON -> OFF", result: "pass", notes: "Switch state followed the command.", run: {} },
      { op: "test_pass", n: 1, by: "kabir", ago: "64d 21h" },
      { op: "approve", n: 1, by: "nisha", ago: "64d 1h" },
    ],
  ),
  p(
    "FF_AXX_CRP_EPS_147_Set_S_Band_radio_01_redundant_switch_ON",
    "EPS/CRP",
    "Switches the S-band radio 1 redundant power switch on and waits for the SBT-1 peripheral state to read On.",
    { Pus_Acknowledgement_Flags: ACK },
    [
      { op: "create", by: "rohan", ago: "76d", code: "main" },
      { op: "submit", n: 1, ago: "75d 22h", summary: "Switch the SBT-1 redundant radio switch ON and verify the peripheral state." },
      { op: "review_pass", n: 1, by: "meera", ago: "75d 3h" },
      { op: "test", n: 1, by: "kabir", ago: "74d 22h", name: "Switch ON, peripheral state follows", result: "pass", notes: "", run: {} },
      { op: "test_pass", n: 1, by: "kabir", ago: "74d 21h" },
      { op: "approve", n: 1, by: "nisha", ago: "74d 2h" },
      { op: "retire", by: "nisha", ago: "40d 5h", reason: "SBT-1 declared failed after the pass-310 anomaly. Do not power the radio from the EPS switch until recovery is confirmed." },
      { op: "restore", by: "nisha", ago: "25d 2h", reason: "SBT-1 recovered after the firmware reload; procedure back in service." },
    ],
  ),

  /* ------------------------------------------------------------------------------------------------ FSW */
  p(
    "FF_AXX_CRP_FSW_04_Soft_Reset_of_Active_OBC_by_ARB",
    "FSW/CRP",
    "Soft-resets the active OBC through the Arbitrator, then verifies the reset counter increased by one, the uptime restarted (<= 20 s), the reset reason and that the active OBC did not change.",
    { Pus_Acknowledgement_Flags: ACK },
    [
      { op: "create", by: "asha", ago: "62d", code: "v1" },
      { op: "submit", n: 1, ago: "61d 22h", summary: "Soft reset via the Arbitrator, verify the OBC reset counter increases by one." },
      { op: "create", by: "asha", ago: "61d 21h", from: 1, code: "v2" },
      { op: "review_pass", n: 1, by: "meera", ago: "60d 20h" },
      { op: "test", n: 1, by: "kabir", ago: "59d 22h", name: "Soft reset, counter +1", result: "pass", notes: "Counter 12 -> 13.", run: {} },
      { op: "test_pass", n: 1, by: "kabir", ago: "59d 21h" },
      { op: "approve", n: 1, by: "nisha", ago: "58d 20h" },
      {
        op: "submit", n: 2, ago: "41d 21h",
        summary: "Also check the OBC uptime after the reset (<= 20 s). A reset that did not actually reboot the OBC would otherwise pass on the counter alone.",
      },
      { op: "create", by: "asha", ago: "41d 20h", from: 2, code: "main" },
      { op: "comment", n: 2, by: "meera", ago: "41d 2h", body: "20 s assumes the 3 s settle time. Fine, but keep both numbers in sync if either changes." },
      { op: "review_pass", n: 2, by: "meera", ago: "40d 23h" },
      { op: "test", n: 2, by: "kabir", ago: "39d 22h", name: "Soft reset: counter +1 and uptime restarted", result: "pass", notes: "Uptime 8 s after the 3 s wait.", run: {} },
      { op: "test_pass", n: 2, by: "kabir", ago: "39d 21h" },
      { op: "approve", n: 2, by: "nisha", ago: "38d 21h" },
      {
        op: "submit", n: 3, ago: "20d 22h",
        summary: "Verify the active OBC did not change across the reset (the Arbitrator can fail over). Log an error if it did.",
      },
      { op: "review_pass", n: 3, by: "meera", ago: "19d 21h" },
      { op: "test", n: 3, by: "kabir", ago: "18d 22h", name: "Soft reset, active OBC unchanged", result: "pass", notes: "OBC_1 stayed active.", run: {} },
      { op: "test_pass", n: 3, by: "kabir", ago: "18d 21h" },
      { op: "approve", n: 3, by: "nisha", ago: "17d 19h" },
      // the incident
      {
        op: "reactivate", n: 2, by: "nisha", ago: "9d 3h",
        comment: "#3 caused an unexpected safe-mode entry on pass 1182; rolling back to #2 while we investigate.",
      },
      { op: "withdraw", n: 3, by: "nisha", ago: "9d 2h", comment: "Withdrawn pending root cause. Do not reactivate until the safe-mode entry is understood." },
      { op: "create", by: "asha", ago: "8d 5h", from: 3, code: "v4" },
    ],
  ),
  p(
    "FF_AXX_FCP_FSW_55_Set_Nominal_Bitrate",
    "FSW/FCP",
    "Sets the nominal S-band bitrate on the Arbitrator. In real-time-mode the bitrate is verified on the active transmitter's telemetry (SBT-1 or SBT-2).",
    { Pus_Acknowledgement_Flags: ACK, Bitrate: "128 kBps" },
    [
      { op: "create", by: "rohan", ago: "33d", code: "v1" },
      { op: "submit", n: 1, ago: "32d 20h", summary: "Set the nominal downlink bitrate on the active S-band transmitter and verify it on that transmitter's telemetry in RTM." },
      {
        op: "comment", n: 1, by: "meera", ago: "32d 6h",
        body: "The SBT_2 branch verifies against the SBT-1 bitrate parameter (copy/paste). It checks the wrong transmitter, so it passes or fails for the wrong reason. Should be SBandSbt2TxActvBrt.",
        anchor: { text: "param.SBandSbt1TxActvBrt", nth: 2 },
        resolved: { by: "meera", ago: "31d 22h" },
      },
      { op: "comment", n: 1, by: "meera", ago: "32d 5h 30m", body: "Use logger.info instead of print, so the value shows in the run log and the audit trail.", anchor: { text: "print(Bitrate)" } },
      { op: "review_fail", n: 1, by: "meera", ago: "32d 5h", comment: "SBT_2 branch checks the SBT-1 bitrate parameter (see the line comments). Please fix and resubmit." },
      { op: "create", by: "rohan", ago: "32d 4h", from: 1, code: "main" },
      { op: "submit", n: 2, ago: "31d 20h", summary: "Fix: the SBT_2 branch now verifies SBandSbt2TxActvBrt." },
      { op: "review_pass", n: 2, by: "meera", ago: "30d 22h", comment: "Fixed." },
      { op: "test", n: 2, by: "kabir", ago: "30d 3h", name: "128 kBps on the active transmitter in RTM", result: "pass", notes: "Mock has SBT_2 active in RTM; telemetry followed.", run: {} },
      { op: "test", n: 2, by: "kabir", ago: "30d 2h", name: "512 kBps", result: "pass", notes: "", run: { args: { Bitrate: "512 kBps" } } },
      { op: "test_pass", n: 2, by: "kabir", ago: "29d 20h" },
      { op: "approve", n: 2, by: "nisha", ago: "28d 23h" },
    ],
  ),
  p(
    "FF_AXX_FCP_FSW_40_Set_Default_S_Band_Transmitter",
    "FSW/FCP",
    "Sets the Arbitrator's default S-band transmitter (SBT_1 / SBT_2). Skips the command when the default already is the requested one and confirms the change on telemetry.",
    { Pus_Acknowledgement_Flags: ACK, SBand: "SBT_2" },
    [
      { op: "create", by: "asha", ago: "21d", code: "main" },
      { op: "submit", n: 1, ago: "20d 22h", summary: "Set the default S-band transmitter on the Arbitrator, skipping the command when it is already the requested one." },
      { op: "review_pass", n: 1, by: "meera", ago: "20d 6h" },
      {
        op: "test", n: 1, by: "kabir", ago: "19d 22h", name: "Switch default SBT_1 -> SBT_2", result: "fail",
        notes: "Set was acknowledged but the Default_SbtId telemetry never changed in the 30 s window. Reproduced twice.",
        run: { faults: [{ kind: "freeze_param", q: "/FF/Arbitrator/Default_SbtId" }] },
      },
      { op: "test_fail", n: 1, by: "kabir", ago: "19d 20h", comment: "Telemetry did not follow the command on the bench (see the failed test case and its run)." },
      {
        op: "retest", n: 1, by: "kabir", ago: "19d 6h",
        comment: "The bench's Default_SbtId telemetry was frozen by a stale test override. Bench reset; running the cases again.",
      },
      { op: "test", n: 1, by: "kabir", ago: "18d 23h", name: "Switch default SBT_1 -> SBT_2 (after bench reset)", result: "pass", notes: "Telemetry followed within 1 s.", run: {} },
      { op: "test", n: 1, by: "kabir", ago: "18d 22h", name: "Already SBT_1: no command sent", result: "pass", notes: "Logged 'already equal to required value' and returned.", run: { args: { SBand: "SBT_1" } } },
      { op: "test_pass", n: 1, by: "kabir", ago: "18d 21h" },
      { op: "approve", n: 1, by: "nisha", ago: "17d 20h" },
    ],
  ),
  p(
    "FF_AXX_FCP_FSW_45_Get_OBC_firmware_version",
    "FSW/FCP",
    "Requests the OBC firmware version and logs it as major.minor.patch (first three digits of the version number).",
    { Pus_Acknowledgement_Flags: ACK },
    [
      { op: "create", by: "rohan", ago: "7d 4h", code: "main" },
      { op: "submit", n: 1, ago: "6d 22h", summary: "Read the OBC firmware version and log it as major.minor.patch." },
      {
        op: "comment", n: 1, by: "meera", ago: "6d 3h",
        body: "This assumes a three-digit FV. What happens for FV < 100? Indexing [2] will raise.",
        anchor: { text: "str(OBC_Firmware_version)[0]" },
      },
      { op: "review_pass", n: 1, by: "meera", ago: "5d 20h", comment: "Passing for test, but the FV < 100 comment should be settled before approval." },
      { op: "test", n: 1, by: "kabir", ago: "4d 21h", name: "FV 215 logs 2.1.5", result: "pass", notes: "", run: {} },
      { op: "test_pass", n: 1, by: "kabir", ago: "4d 20h" },
      {
        op: "refuse", n: 1, by: "nisha", ago: "3d 2h",
        comment: "Only the three-digit FV case was tested and Meera's comment on FV < 100 is still open. I need a short-FV case and a failed-Get case before I sign this.",
      },
      { op: "send_back", n: 1, by: "nisha", ago: "1d 3h", comment: "Retest with FV = 42 and with the Get command failing. Kabir, please add both cases." },
    ],
  ),

  /* ------------------------------------------------------------------------------------------------ AOC */
  p(
    "FF_AXX_FCP_AOC_002_Set_the_gain_for_Bdot_controller",
    "AOC/FCP",
    "Sets the B-dot controller gain. Skips the Set when the gain already equals the requested value, otherwise sets it and verifies the new gain on telemetry.",
    { Pus_Acknowledgement_Flags: ACK, K_BdotController: 0.5 },
    [
      { op: "create", by: "rohan", ago: "26d", code: "v1" },
      { op: "submit", n: 1, ago: "25d 22h", summary: "Set the B-dot controller gain and verify it on telemetry." },
      { op: "review_pass", n: 1, by: "meera", ago: "25d 1h" },
      { op: "test", n: 1, by: "kabir", ago: "24d 22h", name: "Gain 0.3 -> 0.5", result: "pass", notes: "", run: {} },
      { op: "test_pass", n: 1, by: "kabir", ago: "24d 21h" },
      { op: "approve", n: 1, by: "nisha", ago: "24d 2h" },
      { op: "create", by: "rohan", ago: "24d 1h", from: 1, code: "main" },
      { op: "submit", n: 2, ago: "1d 6h", summary: "Skip the Set when the gain already equals the requested value." },
    ],
  ),
  p(
    "FF_AXX_FCP_AOC_017_Set_Gyro_auto_reconfiguration_status_TT",
    "AOC/FCP",
    "Time-tagged variant: sets the gyro auto-reconfiguration flag at the given UTC time, with a Get report 2 s before and 2 s after.",
    { Pus_Acknowledgement_Flags: ACK, bool_isGyroAutoReconfigON: "ON", command_Timetag: TT },
    [
      { op: "create", by: "rohan", ago: "31d", code: "main" },
      { op: "submit", n: 1, ago: "30d 20h", summary: "Time-tagged set of the gyro auto-reconfiguration flag, bracketed by two Get commands so the OBC report shows the change." },
      { op: "review_pass", n: 1, by: "meera", ago: "29d 22h" },
      { op: "test", n: 1, by: "kabir", ago: "29d 3h", name: "Set ON at a future time tag", result: "pass", notes: "", run: {} },
      { op: "test", n: 1, by: "kabir", ago: "29d 2h", name: "Set OFF at a future time tag", result: "pass", notes: "", run: { args: { bool_isGyroAutoReconfigON: "OFF" } } },
      { op: "test_pass", n: 1, by: "kabir", ago: "29d 1h" },
      { op: "approve", n: 1, by: "nisha", ago: "28d 3h" },
    ],
  ),

  /* ------------------------------------------------------------------------------------------------ THM */
  p(
    "FF_AXX_CRP_THM_117_Power_ON_internal_battery_heater_1_heater",
    "THM/CRP",
    "Powers on internal battery heater 1. Puts the heater's ATC into Manual first when it is not (waiting up to 70 s for telemetry), then switches the heater on and checks its state.",
    { Pus_Acknowledgement_Flags: ACK },
    [
      { op: "create", by: "meera", ago: "52d", code: "main" },
      { op: "submit", n: 1, ago: "51d 22h", summary: "Power on internal battery heater 1, switching its ATC to Manual first if needed." },
      {
        op: "comment", n: 1, by: "dev", ago: "51d 8h",
        body: "70 s for the ATC switch is generous but matches what the thermal team asked for. Fine.",
        anchor: { text: "timeout=70" },
        resolved: { by: "meera", ago: "51d 6h" },
      },
      { op: "comment", n: 1, by: "dev", ago: "51d 7h", body: "Reviewed by Dev (admin): the author is the only other reviewer, so someone else has to pass it." },
      { op: "review_pass", n: 1, by: "dev", ago: "51d 3h" },
      { op: "test", n: 1, by: "kabir", ago: "50d 22h", name: "ATC Auto -> Manual, heater Off -> On", result: "pass", notes: "Both state changes followed on the mock.", run: {} },
      { op: "test", n: 1, by: "kabir", ago: "50d 21h", name: "ATC already Manual", result: "pass", notes: "Skips the ATC command and only switches the heater.", run: { telemetry: { "/FF/Thermal/Intbatt1_ATcSt": "Manual" } } },
      { op: "test_pass", n: 1, by: "kabir", ago: "50d 20h" },
      { op: "approve", n: 1, by: "nisha", ago: "49d 20h" },
    ],
  ),

  /* ------------------------------------------------------------------------------------------------ PRP */
  p(
    "FF_AXX_FCP_PRP_16_Set_maximum_pulse_duration_OBC_TT",
    "PRP/FCP",
    "Time-tagged: sets the maximum pulse duration of the four thrusters from a list (one value per thruster; raises ValueError for a partial list), with a Get before and after.",
    { Pus_Acknowledgement_Flags: ACK, Durations: [100, 100, 100, 100], Command_Timetag: TT },
    [
      { op: "create", by: "rohan", ago: "6d", code: "main" },
      { op: "submit", n: 1, ago: "5d 22h", summary: "Time-tagged set of the maximum pulse duration for all four thrusters, with a Get before and after." },
      {
        op: "comment", n: 1, by: "meera", ago: "5d 5h",
        body: "Good that a partial list is refused instead of silently leaving thrusters unset.",
        anchor: { text: "raise ValueError" },
        resolved: { by: "meera", ago: "5d 5h" },
      },
      { op: "review_pass", n: 1, by: "meera", ago: "4d 21h" },
      { op: "test", n: 1, by: "kabir", ago: "3d 22h", name: "Four durations, future time tag", result: "pass", notes: "All four Set commands completed in order.", run: {} },
      {
        op: "test", n: 1, by: "kabir", ago: "3d 21h", name: "Three durations raises ValueError", result: "pass",
        notes: "Expected failure: ValueError before any Set command is sent.", run: { args: { Durations: [100, 100, 100] } },
      },
      { op: "test", n: 1, by: "kabir", ago: "3d 20h", name: "Run on the flatsat", result: "blocked", notes: "Flatsat is booked by AIT until Thursday. The mock runs above are the evidence for now." },
      { op: "test_pass", n: 1, by: "kabir", ago: "2d 4h", comment: "Mock cases pass; flatsat case is blocked, not failed." },
    ],
  ),
  p(
    "FF_AXX_FCP_PRP_22_Start_SatDrive_heating",
    "PRP/FCP",
    "Starts SatDrive heating in the given mode (Preparation / Manual_Heating) for a duration, only when the propulsion digital and actuator lines are on, then reads back the controller state and duration.",
    { Pus_Acknowledgement_Flags: ACK, Mode: "Preparation", Duration: 600 },
    [
      { op: "create", by: "rohan", ago: "10d", code: "main" },
      {
        op: "submit", n: 1, ago: "9d 2h",
        summary: "Start SatDrive heating in the requested mode and duration, refusing to start unless the digital and actuator lines are on.",
      },
      { op: "create", by: "rohan", ago: "3d", from: 1, code: "v2" },
    ],
  ),

  /* ------------------------------------------------------------------------------------------------ SYSTEM */
  p(
    "FF_AXX_FCP_SYS_02_Exit_safe_mode",
    "SYSTEM/FCP",
    "Commands the satellite out of safe mode and waits for the system mode telemetry to read Idle. Retries the command and the telemetry read up to five times.",
    { Pus_Acknowledgement_Flags: ACK },
    [
      { op: "create", by: "asha", ago: "48d", code: "v1" },
      { op: "submit", n: 1, ago: "47d 22h", summary: "Command exit from safe mode and wait for the system mode to return to Idle." },
      { op: "review_pass", n: 1, by: "meera", ago: "47d 2h" },
      { op: "test", n: 1, by: "kabir", ago: "46d 22h", name: "Exit safe mode -> Idle", result: "pass", notes: "", run: {} },
      { op: "test_pass", n: 1, by: "kabir", ago: "46d 21h" },
      { op: "approve", n: 1, by: "nisha", ago: "46d 2h" },
      { op: "create", by: "asha", ago: "20d", from: 1, code: "main" },
      {
        op: "submit", n: 2, ago: "8d 1h",
        summary: "Retry the exit command up to 5 times and re-read the system mode up to 5 times. The exit was NAKed on pass 1105 while the OBC was busy.",
      },
      {
        op: "comment", n: 2, by: "meera", ago: "7d 1h",
        body: "Five retries adds up to a long wait on a pass. Fine by me if ops agrees.",
        anchor: { text: "cmd_retry_count=5" },
      },
      { op: "review_pass", n: 2, by: "meera", ago: "6d 1h" },
    ],
  ),
  p(
    "FF_AXX_FCP_SYS_02a_Check_system_state_before_exit_safe_mode",
    "SYSTEM/FCP",
    "Checks the satellite is nominal before leaving safe mode: EPS mode, bus voltage and current windows, reaction-wheel switch states, wheel momentum and body rates. Returns True when every check passes.",
    {},
    [
      { op: "create", by: "rohan", ago: "8d", code: "main" },
      {
        op: "submit", n: 1, ago: "4d 22h",
        summary: "Check EPS mode, bus voltage and current, reaction-wheel switches, wheel momentum and body rates before exit from safe mode.",
      },
      {
        op: "comment", n: 1, by: "meera", ago: "4d 6h",
        body: "RWL4 is only expected OFF on FF01. Confirm the satellite ID check against the config table.",
        anchor: { text: "expected_rwl4 =" },
        resolved: { by: "meera", ago: "4d 3h" },
      },
      { op: "review_pass", n: 1, by: "meera", ago: "4d 1h" },
      { op: "test", n: 1, by: "kabir", ago: "3d 3h", name: "Everything nominal returns True", result: "pass", notes: "Return value True.", run: {} },
      {
        op: "test", n: 1, by: "kabir", ago: "3d 2h", name: "Bus voltage 24 V returns False", result: "pass",
        notes: "Voltage override 24.0 V: the 25.5 V check fails and the procedure returns False and logs the failing parameter.",
        run: { telemetry: { "/FF/EPS/satBusMn_Vol": 24.0 } },
      },
      { op: "test_pass", n: 1, by: "kabir", ago: "2d 20h" },
    ],
  ),

  /* ------------------------------------------------------------------------------------------------ CHECKOUT / SBAND / PAYLOAD / MISC */
  p(
    "FF_AXX_LEOP_SBAND_004a_S_band_1_pre_DSC_checkout",
    "CHECKOUT",
    "LEOP pre-DSC checkout of S-band 1: the SBT-1 peripheral is on, the active transmitter is as expected and the TM mode is real-time.",
    {},
    [
      { op: "create", by: "asha", ago: "70d", code: "main" },
      { op: "submit", n: 1, ago: "69d 21h", summary: "Pre-DSC S-band 1 checkout: SBT-1 peripheral on, active transmitter and TM mode as expected." },
      { op: "review_pass", n: 1, by: "meera", ago: "69d 2h" },
      { op: "test", n: 1, by: "kabir", ago: "68d 22h", name: "All three checks satisfied", result: "pass", notes: "", run: {} },
      { op: "test_pass", n: 1, by: "kabir", ago: "68d 21h" },
      { op: "approve", n: 1, by: "nisha", ago: "67d 21h" },
    ],
  ),
  p(
    "FF_AXX_FCP_SBAND_201_Set_transmit_frequency_for_SBT_1",
    "SBAND/FCP",
    "Sets the SBT-1 transmit frequency (Hz) and verifies it on telemetry.",
    { Pus_Acknowledgement_Flags: ACK, Frequency: 2250000000 },
    [
      { op: "create", by: "rohan", ago: "36d", code: "main" },
      { op: "submit", n: 1, ago: "35d 22h", summary: "Set the SBT-1 transmit frequency and verify it on telemetry." },
      { op: "review_pass", n: 1, by: "meera", ago: "35d 3h" },
      { op: "test", n: 1, by: "kabir", ago: "34d 22h", name: "Set 2250 MHz", result: "pass", notes: "", run: {} },
      { op: "test_pass", n: 1, by: "kabir", ago: "34d 21h" },
      { op: "approve", n: 1, by: "nisha", ago: "34d 1h" },
      { op: "create", by: "rohan", ago: "34d", from: 1, code: "v2" },
      { op: "submit", n: 2, ago: "4d 2h", summary: "Reject frequencies outside the S-band allocation before sending the command." },
      { op: "review_pass", n: 2, by: "meera", ago: "3d 20h" },
      { op: "test", n: 2, by: "kabir", ago: "3d 3h", name: "Set 2250 MHz", result: "pass", notes: "", run: {} },
      { op: "test_pass", n: 2, by: "kabir", ago: "3d 2h" },
      {
        op: "refuse", n: 2, by: "nisha", ago: "2d 4h",
        comment: "The range check uses 2200-2290 MHz, but the licensed TX band for SBT-1 is narrower. I need the numbers from Flight Dynamics and a test at both edges before this goes to PROD.",
      },
    ],
  ),
  p(
    "FF_AXX_FCP_PAY_224_Set_Default_nCCM_2_PGain",
    "PAYLOAD/FCP",
    "Sets the default P-gain of nCCM-2's sensor: Get, Set, then Get again and check the telemetry equals the requested gain.",
    { Pus_Acknowledgement_Flags: ACK, PGain: 4 },
    [
      { op: "create", by: "asha", ago: "1d 2h", code: "main" },
      { op: "submit", n: 1, ago: "5h", summary: "Set the default nCCM-2 sensor P-gain with a Get before and after, verified on telemetry." },
    ],
  ),
  p(
    "FF_AXX_FCP_PAY_251_Set_Default_nCCM_1_VFlip",
    "PAYLOAD/FCP",
    "Sets the default vertical-flip state (0/1) of nCCM-1's sensor with a Get before and after and a telemetry check.",
    { Pus_Acknowledgement_Flags: ACK, State: 1 },
    [
      { op: "create", by: "asha", ago: "6d 5h", code: "v1" },
      { op: "submit", n: 1, ago: "5d 22h", summary: "Set the nCCM-1 default vertical flip." },
      {
        op: "comment", n: 1, by: "meera", ago: "5d 2h",
        body: "The Set is never verified. The sibling nCCM procedures read the value back (Get, then check the telemetry). Please do the same.",
        anchor: { text: "execute_await_completion" },
      },
      { op: "comment", n: 1, by: "meera", ago: "5d 1h", body: "State is an int but only 0 and 1 are valid. Say so in a comment at least." },
      { op: "review_fail", n: 1, by: "meera", ago: "4d 20h", comment: "The Set is never verified against telemetry (see the line comment). Needs a read-back before it can be tested." },
      { op: "create", by: "asha", ago: "4d 1h", from: 1, code: "main" },
      { op: "run", n: 2, by: "asha", ago: "3d 22h" },
    ],
  ),
  p(
    "are_you_alive",
    "MISCELLENOUS",
    "Sends the Arbitrator Are_You_Alive command and prints the Arbitrator's reply telemetry. Returns the failure result if the command failed.",
    { Pus_Acknowledgement_Flags: ACK },
    [
      { op: "create", by: "asha", ago: "82d", code: "main" },
      { op: "submit", n: 1, ago: "81d 22h", summary: "Ping the Arbitrator and print its reply." },
      { op: "review_pass", n: 1, by: "meera", ago: "81d 4h" },
      { op: "test", n: 1, by: "kabir", ago: "80d 22h", name: "Arbitrator answers", result: "pass", notes: "Reply 'Arbitrator | Yes'.", run: {} },
      { op: "test_pass", n: 1, by: "kabir", ago: "80d 21h" },
      { op: "approve", n: 1, by: "nisha", ago: "80d 2h" },
    ],
  ),
];
