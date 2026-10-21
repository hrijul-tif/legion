---
document: Entity Model
version: 0.29
status: re-baselined against the 2026-09-18 tracker snapshot — awaiting Phase 1 review by someone other than the PM
last_updated: 2026-10-13
reviewed_by: TBD
source: extraction pass over 35 MOS requirements (LEO-032 … LEO-113), re-baselined against raw/requirements.md and the engineers' feature list
---

# MOS Entity Model

> Tier-0. Most referenced document in the critique process.
>
> Two separate models below. **Domain items** persist and are referenced.
> **Runtime components** do work. They are not the same kind of thing and are
> deliberately not drawn in one diagram.
>
> Unresolved items are marked `UNRESOLVED — OQ-NNN`. They are holes on purpose.
> A model with honest holes is usable; one with plausible guesses propagates
> errors into every critique that follows.

## Why this is not 1.0

The Phase 1 gate requires review by someone other than the PM. Every decision
closing an item below was taken by the PM, several on questions owned by the
tech lead. On sign-off this becomes 1.0.

Version numbering note: these increment as 9, 10, 11 — not as decimals. The
0.9 model predates the 2026-09-18 re-baseline.

## What changed at 0.29

| Change | Decision |
|---|---|
| A retired set can be restored to DEV; moves, retirements and restores are all recorded | DEC-056 |

## What changed at 0.28

| Change | Decision |
|---|---|
| A set that has been in PROD can't be deleted, only retired | DEC-055 |

## What changed at 0.27

| Change | Decision |
|---|---|
| A conditional breakpoint names a `MissionEvent`; it holds no expression of its own | DEC-054 |

## What changed at 0.26

| Change | Decision |
|---|---|
| New entity `ProcedureSetSnapshot`: a set frozen on each move into PROD | DEC-053 |
| A `SequenceExecution` runs a `ProcedureSetSnapshot`, not the editable set | DEC-053 |

## What changed at 0.25

| Change | Decision |
|---|---|
| A procedure's priority in a set is called its **tier** | DEC-052 |

## What changed at 0.24

| Change | Decision |
|---|---|
| Sets are built in DEV or TEST and moved into PROD; only the move is logged | DEC-050 |
| `SequenceEntry` carries a hook or predecessor, a priority and argument values | DEC-051 |

## What changed at 0.23

| Change | Decision |
|---|---|
| `SequenceOfEvents` is called a procedure set; activity sheet and pass sheet stay as synonyms | DEC-049 |

## What changed at 0.22

| Change | Decision |
|---|---|
| Lifecycle states renumbered to close the gap at 4: 5a–5b → 4a–4b, 6a–6d → 5a–5d, 7 → 6 | DEC-048 |

## What changed at 0.21

| Change | Decision |
|---|---|
| `review passed, awaiting test` and `test in progress` merged into `review passed, test in progress` — nine snapshot states | DEC-047 |

## What changed at 0.20

| Change | Decision |
|---|---|
| Without contact to the state authority, PROD starts no new sheet once the time bound passes | DEC-045 |

## What changed at 0.19

| Change | Decision |
|---|---|
| A sheet resolves its procedures to approved snapshots when it starts, and keeps them until it ends | DEC-044 |

## What changed at 0.18

| Change | Decision |
|---|---|
| Authoring moves from an external IDE to a hosted workspace opened from MOS | DEC-043 |

## What changed at 0.17

| Change | Decision |
|---|---|
| `Procedure` and `ProcedureVersion` are held by MOS; how MOS stores them is the tech team's call | DEC-042 |
| `ProcedureVersion` reclassified from external reference to entity | DEC-042 |
| The repository leaves the external systems list | DEC-042 |

## What changed at 0.16

| Change | Decision |
|---|---|
| Lifecycle state attaches to the snapshot (`ProcedureVersion`), not the procedure — reverses DEC-033 | DEC-040 |
| State set becomes two levels: ten snapshot states, two procedure states | DEC-040 |
| `Environment` value set — DEV, TEST, PROD; shared vs per-environment components | DEC-041 |
| Hosted workspace and flatsat added as external systems | DEC-041 |

## What changed at 0.15

| Change | Decision |
|---|---|
| The tracker guides, a PRD refines — recorded as a standing rule | DEC-037 |

## What changed at 0.14

| Change | Decision |
|---|---|
| What holds a `Procedure` is unresolved — defined in the file and server management PRD | DEC-036 |

## What changed at 0.13

| Change | Decision |
|---|---|
| Transition rules move out of tier-0 — the model keeps the state set only | DEC-035 |

## What changed at 0.12

| Change | Decision |
|---|---|
| Lifecycle state set revised — ten states, `approval failed` added | DEC-034 |
| `approved` now leads only to `in progress` or `retired` | DEC-034 |

## What changed at 0.11

| Change | Decision |
|---|---|
| Lifecycle state attaches to `Procedure`, not `ProcedureVersion` | DEC-033 |
| Procedure lifecycle state added as a value set | DEC-033 |

## What changed at 0.10

Driven by the 2026-09-18 tracker snapshot (DEC-021) and a review pass applying
the classification test below.

| Change | Decision |
|---|---|
| Data dictionary entities dropped — not MOS-owned | DEC-022 |
| `Simulation Engine` deleted — simulation and replay are external | DEC-023 |
| `ExitState` narrowed — rollback lives inside procedures | DEC-024 |
| `Collaboration Service` deleted, `Workflow Engine` folded | DEC-025 |
| LEO-103 reinstated as basic impact analysis, no new entity | DEC-026 |
| `ContactAssignment` deleted — a sequence *is* the pass sheet | DEC-027 |
| `Step` deleted — annotations and status are per procedure execution | DEC-028 |
| FDS event types become a value set; occurrences referenced externally | DEC-029 |
| `PostPassReport` is generated once and stored | DEC-030 |
| Both approval entities fold into `StateTransition` | DEC-031 |
| Domain items classified by kind, with who holds the data | DEC-032 |

## Note on counts

The v0.2 revision stated 27 domain entities and 15 core components; neither
matched its own tables. Counts below are recounted from the tables every
revision. Figures quoted in DEC-010 and DEC-021 should be read as approximate.

---

## Classification

Not every noun in the requirement baseline is an entity. Each item below was
tested on three limbs:

1. **Identity** — can you point at one and say "that one"?
2. **Persistence** — does it outlive a single operation?
3. **Reference** — does something else need to hold a pointer to it?

| Kind | Test result |
|---|---|
| **Entity** | all three |
| **Record** | identity and persistence; nothing references it |
| **External reference** | all three, but held by another system |
| **Value set** | no per-member identity — an enumeration |

An item that fails the test is not modelled. It becomes an attribute of
something else, a binding, a component behaviour, or a view.

`Held by` below is where the data lives, not which component reads it.

---

## Domain items

**19 modelled items** — 11 entities, 4 records, 4 external references — plus 5
value sets and 1 undefined.

### Entities

| Entity | Held by | Notes |
|---|---|---|
| `Procedure` | MOS (DEC-042) | A `.py` file. Set of actions with well-defined exits, reusable. **May contain telecommands, may act only on ground software** (DEC-015, amending DEC-003). Identity is the file path today; whether it should be a stable ID carried in the file is UNRESOLVED — OQ-060. Templates with input parameters (LEO-074) are procedures, not a separate kind. |
| `ProcedureVersion` | MOS (DEC-042) | **The snapshot.** Frozen on submit; never changes. Carries the lifecycle state (DEC-040) and is what moves between environments. Referenced by `StateTransition` and `ProcedureExecution`. LEO-078 stays rejected as a feature; this is the mechanism underneath (OQ-051, answered). |
| `ProcedureExecution` | MOS | An instance of running a version. The unit of execution status and annotation (DEC-028). |
| `SequenceOfEvents` | MOS | Ordered set of procedures with hooks and conditions. **Called a procedure set** (DEC-049), also an activity sheet or pass sheet — the same entity, not a second one (DEC-027). Spans one or many contacts, because its entries may hook to different contacts. General container — **not scoped to LEOP/commissioning** (OQ-034). Built in DEV or TEST and moved into PROD, never edited in PROD; only the move is logged (DEC-050). Deletable only if never moved into PROD; otherwise retired, keeping its snapshots (DEC-055). A retired set can be restored to DEV, never straight to PROD; every move, retirement and restore is recorded as a `LogEntry` with who and when (DEC-056). |
| `SequenceEntry` | MOS | A procedure's slot in a sequence (DEC-016). Carries order, breakpoints, conditional breakpoints — each naming a `MissionEvent` (DEC-054) — progression conditions (LEO-082), and the whole hook: anchor type, anchor instance, signed offset (DEC-014, DEC-027). Instead of a hook, it may name a predecessor entry. Also carries a tier — called priority until DEC-052 — (Lowest by default) and argument values (DEC-051); how a procedure declares its arguments is UNRESOLVED — OQ-065. Many-to-many: a procedure may appear in many sequences. |
| `ProcedureSetSnapshot` | MOS | **The set's snapshot.** Frozen on each move into PROD (DEC-053); never changes. Holds the set's name, description and every entry with its start rule, tier and argument values. Records who moved it and when, and is numbered per set. PROD runs the latest one. Names procedures, not procedure versions — those are resolved when the set starts (DEC-044). |
| `SequenceExecution` | MOS | Distinct from `ProcedureExecution`. Sequence-level control per LEO-083. Runs a `ProcedureSetSnapshot` (DEC-053). |
| `Role` | identity provider or MOS — UNRESOLVED | One permission model across all four scopes: procedures (LEO-077), procedure database (LEO-079), sequence execution (LEO-095), pass actions (LEO-113). No longer inferred — the engineers' feature list names role-based access twice. |
| `DetectedAnomaly` | MOS | System-generated from telemetry (LEO-032, 093). |
| `ReportedAnomaly` | MOS | Operator-captured during execution (LEO-102). |
| `NotificationChannel` | MOS | "chosen media" (LEO-032), "configured channels" (LEO-093). Configuration, but named and referenced. |

### Records

Append-only. Written and read, never referenced by another item.

| Record | Held by | Notes |
|---|---|---|
| `LogEntry` | MOS; archive in YAMCS | Single master logger holds all log types (DEC-008). Archive ownership UNRESOLVED — OQ-043. |
| `StateTransition` | MOS | LEO-077 requires the responsible user recorded on **every** transition. Absorbs both approval entities (DEC-031). Carries a target field: a `ProcedureVersion` or a `SequenceExecution` (DEC-040). Cannot express a standing grant — UNRESOLVED — OQ-050. |
| `Annotation` | MOS | Operator notes, attached to a `ProcedureExecution` (LEO-102, narrowed by DEC-028). |
| `PostPassReport` | MOS | LEO-093. Generated once, stored, distributed on demand (DEC-030). Deviates from LEO-093's push wording — UNRESOLVED — OQ-044. |

### External references

These pass all three limbs, but the data is not MOS's. MOS stores a pointer,
and the pointer is load-bearing.

| Item | Held by | What MOS stores |
|---|---|---|
| `Pass` | MPS | Geometric visibility window over a location. Referenced for reporting and views. |
| `Contact` | MPS | Reserved booking with a GS provider on a named antenna. Referenced from `SequenceEntry` to resolve AOS/LOS occurrences. Scheduling target is the contact, not the pass (DEC-006). |
| `User` | identity provider | Synonymous with operator. Use one term consistently. Provider not yet named — see `03-constraints.md`. |
| FDS event occurrence | FDS via MCS | The occurrence of an AOS, LOS, eclipse entry or exit (DEC-029). Nothing is stored; the hook names a type and MOS resolves the occurrence at run time. Whether MCS exposes actual occurrences as a live feed is UNRESOLVED — OQ-039, and without one the actual-variant hooks of DEC-014 are undeliverable. |

### Value sets

No per-member identity. Enumerations, not entities.

| Value set | Notes |
|---|---|
| `ExitState` | Closed, mission-invariant set (DEC-012). Narrowed by DEC-024: no rollback or compensation members, because compensation is a catch block inside the procedure. Membership UNRESOLVED — OQ-029. |
| `Permission` | A named capability (LEO-077, 079, 095, 113). |
| FDS event type | `AOS`, `LOS`, `eclipse entry`, `eclipse exit`, each in planned and actual variants (DEC-014, DEC-018, DEC-029). |
| Procedure lifecycle state | Two levels — ten snapshot states, two procedure states (DEC-040). See the section below. |
| `Environment` | `DEV`, `TEST`, `PROD` (DEC-041). Where a snapshot sits follows from its state, so there is no deployment record — location is a view. |

### Undefined

| Item | Notes |
|---|---|
| `MissionEvent` | LEO-090. The classification test cannot be run on it, because there is no definition to test. UNRESOLVED — OQ-023. |

### Hook anchors

A hook is a binding, not an entity (DEC-013). Its attributes live on
`SequenceEntry`: an anchor type, an anchor instance where one is needed, and a
signed offset.

| Anchor type | Instance |
|---|---|
| FDS event type — AOS, LOS, eclipse entry/exit | a `Contact` |
| `MissionEvent` | UNRESOLVED — OQ-023 |
| absolute timestamp | none (DEC-027) |

Two anchor questions remain, neither shape-changing: whether the AOS/LOS
anchor resolves against the geometric pass or the booked contact is **answered**
— the hook names a contact, so it resolves against the contact (OQ-032); and
whether MCS exposes a live feed of actual anchors — UNRESOLVED — OQ-039.

Also referenced as an anchor by LEO-090: procedure execution outcome and
timestamp. Covered by `ProcedureExecution` + `ExitState`, not a distinct item.

### Procedure lifecycle states

Two levels, agreed with the PM and specified in
`prds/procedure-lifecycle-states.md`.

**Snapshot states** — on a `ProcedureVersion`, frozen on submit:

| # | State |
|---|---|
| 2 | ready for review |
| 3a | review passed, test in progress |
| 3b | review failed |
| 4a | tests passed, awaiting approval |
| 4b | test failed |
| 5a | approved |
| 5b | approval failed |
| 5c | superseded — a newer snapshot of the same procedure was approved |
| 5d | withdrawn — an approver removed approval |

**Procedure states** — on the `Procedure` itself:

| # | State |
|---|---|
| 1 | in progress — a working copy with unsubmitted changes exists |
| 6 | retired — no new use; approved snapshot leaves PROD |

**Invariant:** at most one snapshot per procedure is `approved` (DEC-040).
Approved means available in PROD; there is no separate release step. A sheet
resolves each procedure to its approved snapshot when the sheet starts and
keeps it until the sheet ends (DEC-044).

Every gate has a pass state and a fail state. **Which moves between states are
allowed is specified in the PRD, not here** (DEC-035) — the model records the
set, so a change to the rules does not bump a tier-0 document.

LEO-076 names five — `work in progress`, `review required`, `test in progress`,
`tested`, `approved` — under a "such as", and covers none of the three failed
states nor retirement. The tracker is not amended to match: it guides, and the
PRD refines it (DEC-037, OQ-054).

State belongs to the snapshot (DEC-040). A snapshot never changes, so a failed
snapshot is finished — the fix is a new snapshot. `superseded` and `withdrawn`
may return to `approved` without re-review; that is rollback. Retirement is
reversible.

**`validated` is not a state** — it is a property meaning finally approved,
derived from a snapshot's state being `approved` rather than from a separate
approval entity (DEC-031, DEC-040).

Configurable workflow rules are **skipped** per the tracker's own comment on
LEO-077, so there is no rule entity and no rule engine (DEC-025).

`SequenceOfEvents` has no lifecycle states. The engineers' feature list asks
for them, no requirement covers them, and adding them is a field plus reuse of
`StateTransition` — deferred, OQ-049.

### Removed

| Item | Removed at | Reason |
|---|---|---|
| `TimelineHookEvent` | 0.9 | a binding, not an entity (DEC-013) |
| `PassMilestone` | 0.9 | merged into FDS events (DEC-018) |
| `Step` | 0.10 | step-level annotation and status dropped (DEC-028). LEO-071's "fresh samples after a step" is an in-procedure API call, not a modelled item. |
| `ContactAssignment` | 0.10 | the binding fits as a contact reference on `SequenceEntry` (DEC-027) |
| `AuthoringApproval` | 0.10 | folded into `StateTransition` (DEC-031) |
| `ExecutionApproval` | 0.10 | folded into `StateTransition` (DEC-031) |
| `TelecommandDefinition` | 0.10 | data dictionary is not MOS-owned (DEC-022) |
| `ParameterDefinition` | 0.10 | as above |
| `TelemetrySample` | 0.10 | as above — YAMCS owns TM/TC and archival |
| `TelecommandRelease` | 0.10 | as above |

---

## Runtime components

**10 core, 2 adaptation, 4 external.**

### Core — mission-invariant

| Component | Requirements |
|---|---|
| Frontend (unified) | 102, all UI surfaces, sequence assembly and hook linkage |
| Procedure Library | 074, 076, 077, 079, 103 (basic impact analysis), search |
| Orchestrator | 081, 082, 083, 085, 086 |
| Procedure Executor | 070, 071, 083, 087 |
| Task Scheduler | 084, 089, 090 |
| Anomaly Detector | 032 |
| Notification Service | 032, 093 |
| Master Logger | 075, 102, 113 |
| Authorization Service | 077, 079, 095, 113 |
| Reporting Service | 093 |

Deleted since 0.9:

| Component | Reason |
|---|---|
| `Search Service` | search is a Procedure Library feature (DEC-019) |
| `Simulation Engine` | Bifrost, the FSW OBC simulator and YAMCS do this (DEC-023) |
| `Collaboration Service` | LEO-104 is On Hold and may be answered by GitHub PRs (DEC-025) |
| `Workflow Engine` | configurable rules skipped; state and transitions fold into Procedure Library (DEC-025) |

Two component questions are open. Orchestrator / Executor boundary remains
provisional — UNRESOLVED — OQ-011; LEO-083's control verbs may sit in either,
and LEO-087 (live sequence modification) is provisionally in Executor.
Parallel execution and procedure priority, asked for by the engineers with no
requirement behind them, land on the same boundary — UNRESOLVED — OQ-046.

Whether MOS establishes the RF link itself for LEO-089, or delegates to MCS or
ground-station software, is UNRESOLVED — OQ-041. No component owns link
establishment today.

**Where components run** (DEC-041). Three environments — `DEV`, `TEST`,
`PROD` — each run MOS, but not every component runs in each.

| Shared — one instance | Per environment |
|---|---|
| Procedure Library — holds all lifecycle state | Procedure Executor |
| Authorization Service | Orchestrator |
| Master Logger | Task Scheduler |
| Frontend | Anomaly Detector |

Environments hold copies of procedures; only the Procedure Library holds their
state. If PROD loses contact with the shared Library, sheets already running
continue, and no new sheet starts once the time bound passes (DEC-045).

### Adaptation — varies per satellite

| Component | Notes |
|---|---|
| Generated TM/TC library | Python classes for telecommands, telemetry, associated statuses. Static definitions plus a client wrapper over MCS APIs. Present in every hosted workspace for real-time lookup during authoring (DEC-043). |
| Class generator | Build-time tool producing the above from the spacecraft database. UNRESOLVED — OQ-021: what generates it, and when. |

**This is the whole of the per-satellite variation.** Ten invariant components
against one generated library and one generator. Nothing at runtime knows which
satellite it is flying. `ExitState` being mission-invariant (DEC-012) preserves
this boundary rather than adding a second adaptation surface.

The engineers' feature list asks for satellite-specific and firmware-specific
procedure execution, which would breach that boundary. Whether firmware
applicability is a compatibility tag on `Procedure` or an item with content MOS
must read is UNRESOLVED — OQ-047.

### External

| Component | Notes |
|---|---|
| MCS — Mission Control System | Exposes APIs for querying live TM/TC and everything associated with them. Whether it also exposes actual anchor occurrences as a live feed is UNRESOLVED — OQ-039. Whether MCS and YAMCS are the same system is UNRESOLVED — OQ-043. |
| MPS — pass booking | APIs already exposed. Holds `Pass` and `Contact`, and records who booked each contact (LEO-113). |
| Bifrost + FSW OBC simulator | Procedure and sequence testing, per the tracker's comment on LEO-099. Covers the engineers' "procedure testing apparatus" (DEC-023). |
| Hosted workspace and editor | Where a developer writes a procedure: a checkout of their branch on DEV, opened from the Frontend, with the generated TM/TC library present. Product-neutral (DEC-041). |
| Flatsat | Hardware test target beside the simulator. A scarce shared resource — booking is unaddressed. |

### Not a MOS component

**The editor itself** — the hosted workspace's editor is a third-party
product, opened from MOS (DEC-043). MOS provides the workspace and the
generated TM/TC classes in it, so LEO-069 and LEO-073 are back inside MOS.
Further tooling — an extension, a language server — is out of scope for v1
(OQ-020).

---

## Provenance

Which requirements each item was drawn from. This is **provenance**, not
coverage — it records where the item was found, not every requirement that
depends on it.

`extracted` = named or clearly implied in the requirement text.
`inferred` = not named anywhere; deduced from behaviour the requirements assume.

**Inferred items warrant scrutiny.** An item with no requirement behind it is
either a gap in the requirement baseline or something the extraction pass
invented.

| Item | Requirements | Basis |
|---|---|---|
| `Procedure` | 069, 070, 071, 073, 074, 076, 077, 079, 081, 082, 083, 095, 102 | extracted |
| `ProcedureExecution` | 075, 083, 090, 095, 102 | extracted |
| `SequenceOfEvents` | 081, 082, 083, 084, 085, 086, 087, 090, 095 | extracted |
| `SequenceEntry` | 081, 082, 085, 090 | inferred — many-to-many with order, conditions and hook binding; never named in the baseline |
| `SequenceExecution` | 083, 087, 095 | extracted |
| `ProcedureSetSnapshot` | — | inferred — no requirement. PM decision (DEC-053), so an incident review can see what was released at each move into PROD. |
| `Role` | — | inferred from the baseline; **named twice in the engineers' feature list**, which is the first direct evidence for it |
| `DetectedAnomaly` | 032, 093 | extracted |
| `ReportedAnomaly` | 102 | extracted |
| `NotificationChannel` | 032, 093 | inferred — "chosen media" and "configured channels"; never modelled |
| `LogEntry` | 075, 083, 102, 113 | extracted |
| `StateTransition` | 076, 077, 095 | extracted — LEO-077 requires the user on every transition |
| `Annotation` | 102 | extracted |
| `PostPassReport` | 093 | extracted |
| `ProcedureVersion` | — | inferred — LEO-078 is rejected, so nothing in the baseline requires it. It exists because snapshots carry lifecycle state (DEC-040), and is held by MOS (DEC-042). |
| `Pass` | 084, 085, 089, 090, 093, 113 | extracted |
| `Contact` | 089, 113 | extracted |
| `User` | 077, 079, 095, 113 | extracted |
| FDS event occurrence | 090 | extracted |
| `ExitState` | 082, 085, 090 | inferred — "well defined exits" per DEC-003; no requirement enumerates them. Closed by decision (DEC-012), which fills a baseline gap rather than recording one. |
| `Permission` | 077, 079, 095, 113 | extracted |
| FDS event type | 090 | extracted — absorbs `PassMilestone` (DEC-018) |
| `MissionEvent` | 090 | extracted, undefined |

### Requirements contributing no domain item

Behavioural or cross-cutting requirements that shape components rather than
introduce items: 072 (absent), 094 (absent), 097-098 (absent), 103 (a read-only
query over existing relationships, DEC-026), 106-112 (absent). Rejected
requirements contribute nothing: 078, 080, 091, 092, 096, 100, 101, 105.

Note that LEO-032 sits well outside the LEO-069…113 block. Confirm it belongs
to this requirement set rather than being an artefact of the spreadsheet export.

### Baseline gaps

1. No requirement covers operator assembly of a sequence or the hook-linkage
   UI, though both the operator and the engineers' feature list describe them
   as central. UNRESOLVED — OQ-040. The `Frontend` row rests on that basis and
   not on a requirement.
2. Procedure search has no surviving requirement — LEO-105 is rejected. It is
   retained as a Procedure Library affordance under DEC-019 and appears on the
   engineers' feature list. Deferred — OQ-052.
3. LEO-089 requires "execution of predefined activities for that pass" with no
   operator-set hook. With `ContactAssignment` deleted and LEO-086 On Hold,
   nothing holds the standing activities for a pass. UNRESOLVED — OQ-042.
4. Five items on the engineers' feature list have no requirement at all:
   sequence lifecycle states (OQ-049), parallel execution and priority
   (OQ-046), flag-triggered execution (OQ-045), firmware applicability
   (OQ-047), anomaly tracker integration (OQ-048).

## Relationships

```
Procedure          1---* ProcedureVersion                      held by MOS (DEC-042)
ProcedureVersion   1---* ProcedureExecution
SequenceOfEvents   1---* SequenceEntry
SequenceEntry      *---1 Procedure
SequenceEntry      0..1 anchor type + signed offset            value set | MissionEvent | absolute time
SequenceEntry      0..1 Contact                                MPS-held; resolves AOS/LOS occurrences
SequenceEntry      0..* MissionEvent                           conditional breakpoints (DEC-054); also a hook anchor
SequenceOfEvents   1---* ProcedureSetSnapshot                  DEC-053
ProcedureSetSnapshot 1---* SequenceExecution                   DEC-053
SequenceExecution  1---* ProcedureExecution
Pass               1---* Contact                               UNRESOLVED — OQ-025
ProcedureExecution 1---* LogEntry
ProcedureExecution 1---* ReportedAnomaly
ProcedureExecution 1---* Annotation
DetectedAnomaly    1---* LogEntry
User               1---* Role  ---* Permission
User               1---* StateTransition
StateTransition    *---1 target -> ProcedureVersion | SequenceExecution     DEC-040
User               1---* ProcedureExecution
User               1---* ReportedAnomaly
```

Edges removed at 0.10: both `ContactAssignment` edges (DEC-027),
`ProcedureVersion 1---* Step` (DEC-028), and both approval edges (DEC-031).

## Requirements rejected, on hold, or narrowed

Per the 2026-09-18 tracker snapshot (DEC-021).

| Req | Status | Note |
|---|---|---|
| LEO-078 | Rejected | Per the PM. `raw/requirements.md` still transcribes Accepted — re-transcription pending. |
| LEO-080 | Rejected | Compensation is a catch block inside the procedure (DEC-024) |
| LEO-091 | Rejected | Graphical timeline picked up in V2 — Frontend loses the surface |
| LEO-092 | Rejected | Pass sequence optimisation |
| LEO-096 | Rejected | Per-satellite execution only; constellation layer above MOS later (DEC-004) |
| LEO-100 | Rejected | Context-aware assistance |
| LEO-101 | Rejected | Replay is outside MOS and needs a simulator (DEC-023) |
| LEO-105 | Rejected | Natural-language search. Plain lookup retained — OQ-052 |
| LEO-075 | On Hold | Execution history rationale queried; the rest is accepted |
| LEO-084 | On Hold | Rationale required |
| LEO-085 | On Hold | Inter-sequence dependencies — also the feature list's "SOE chaining" |
| LEO-086 | On Hold | Default pass sequence — bears on OQ-042 |
| LEO-087 | On Hold | Live sequence modification |
| LEO-088 | On Hold | Pass communication configuration — bears on OQ-041 |
| LEO-099 | On Hold | Scope of simulation; external tooling named (DEC-023) |
| LEO-104 | On Hold | "Would gate-keeping through GitHub PR be enough?" |
| LEO-113 | On Hold | "What does authorisation for pass-related actions mean?" |
| LEO-077 | Narrowed | Configurable workflow rules skipped per the tracker's own comment |
| LEO-083 | Narrowed | Step-level status becomes procedure-level (DEC-028) |
| LEO-093 | Narrowed | Distribution on demand rather than on generation (DEC-030) — OQ-044 |
| LEO-102 | Narrowed | Marking steps becomes marking procedure executions (DEC-028) |
| LEO-103 | Reinstated | Basic impact analysis only: which pass sheets use a changed procedure (DEC-026) |