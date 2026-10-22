# Sim files (mock spacecraft)

`public/sim/<mission>-sim.json` (e.g. `ff-sim.json`) tells the sandbox what the mock spacecraft looks like and
what commands do. The run worker fetches it at the start of every run (no caching), so edits apply on the next
Dry run. A run can also pass an inline object as `options.sim`. The JSON Schema is `sim.schema.json`.

Everything is optional. Without a sim file every parameter starts at a default (enum: first member, numbers: 0,
bool: false, string: ""), every command completes successfully after 0.4-1.2 virtual seconds and only bumps the
generic command counter (`/MOS/CommandCounter`, visible in the telemetry snapshot).

```jsonc
{
  "defaultCadence": 1,                 // virtual seconds between telemetry samples of each parameter
  "latency": [0.4, 1.2],               // default command completion latency range
  "initial": { "/FF/OBC/Reset_Counter": 12, "/FF/Arbitrator/Active_OBC": "OBC_1" },
  "cadence": { "/FF/OBC/Uptime": 5 },  // per-parameter sampling period override (0 = event driven only)
  "rates":   { "/FF/OBC/Uptime": 1 },  // continuously ramping numeric parameters (value + rate * dt)
  "effects": [
    {
      "command": "/FF/Arbitrator/Reset_OBC",     // qualified name | class name | glob
      "when":    { "Pus_Acknowledgement_Flags": "Acceptance | Completion" },  // optional, wire args
      "delay":   1.0,                            // optional: virtual seconds until completion
      "set": {
        "/FF/OBC/Reset_Counter": { "add": 1 },   // previous + 1
        "/FF/OBC/Uptime": 5,                      // literal
        "/FF/EPS/slrPnl3ShntThd_Vol": { "fromArg": "Threshold" },
        "/FF/X/Y": { "expr": "prev * 2 + args['Gain']" }
      },
      "sample": ["/FF/OBC/Mode"],                 // optional: force a telemetry sample, value unchanged
      "then": [ { "after": 5, "set": { "/FF/OBC/Mode": "NOMINAL" } } ],   // optional follow-ups
      "fail": false                                // optional: make the command fail
    }
  ]
}
```

## Semantics

* **Time is virtual.** `time.sleep` / `time.time` / `datetime.now` inside procedures use the virtual clock. Real
  waiting is virtual / warp (warp = Infinity: no real waiting).
* **Sampling.** A parameter is sampled every `cadence` virtual seconds (each parameter has a stable phase offset).
  `read_latest_parameter_value` returns the latest sample; `read_fresh_parameter_value` waits for a sample received
  after the read started (default timeout 10 s, then the "returned NONE" prompt).
* **Effects** are applied when the command completes successfully (not for failed / timed-out commands). Every
  `set` also produces an immediate sample of that parameter, so telemetry reflects the command from the moment it
  completed (and "reception time > command time" checks pass). `sample` forces a sample without changing the value.
  UI inspector overrides behave the same way (value changes and is sampled immediately).
* **Matching.** All effects whose `command` and `when` match are applied in file order. `when` values compare loosely
  (`"3.2"` == `3.2`); a list means "any of". Command arguments are the wire names/values from `command_arguments`
  (enum members as their string value).
* **Values.** Enum parameters use the enum member *value* (the YAMCS label); member names and case-insensitive
  labels are also accepted in the file. `expr` is evaluated with `args`, `prev`, `t`, `math`, `min`, `max`, `abs`,
  `round`, `int`, `float`, `str`, `len`, `sum`, `bool`.
* **Faults** (UI): `command_fails` (command completes with NOK), `command_timeout` (never completes: `await_complete`
  waits its timeout, or 30 virtual seconds without one), `freeze_param` (no new samples, cache keeps the old
  value), `drop_param` (nothing ever received: cache returns None, fresh reads time out).
* Unknown parameter / command names in the file produce `sim` warnings in the run log.
* `raw_value` of enum parameters is the member index; other parameters return the engineering value as raw value.
