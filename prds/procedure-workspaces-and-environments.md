---
prd_id: PRD-002
feature: Procedure Workspaces and Environments
requirement_ids: LEO-069, LEO-073, LEO-074, LEO-077, LEO-079, LEO-099, LEO-104
domain_items: Procedure, ProcedureVersion, StateTransition, Environment, User, Role, Permission
entity_model_version: 0.20
version: 0.22
status: draft
owner: PM
last_updated: 2026-10-09
---

# Procedure Workspaces and Environments

*Formerly: Decision Environments (DEC-046).*

## 1. Summary

One place inside MOS to create a procedure, write it, get it reviewed, test
it and approve it — without leaving MOS for a terminal or a git website.

Three environments back this. **DEV** is where procedures are written and
tried out against the simulator or flatsat. **TEST** is where reviewed
snapshots are formally tested, on the same MOS build as production. **PROD**
is where approved snapshots run against the satellite — a snapshot is available
there the moment it is approved. A procedure moves between environments as
frozen snapshots, and every snapshot's state is tracked in one place regardless
of where its copies sit.

## 2. User problem

Today an operator does six things before a procedure can be used, none of them
in MOS:

| Step | Where |
|---|---|
| Clone the repository | terminal |
| Set up a local environment | laptop |
| Write the procedure | local editor |
| Commit | terminal |
| Raise a pull request | terminal or git website |
| Merge | terminal or git website |

Three problems follow.

**There is nowhere to try things.** An in-progress procedure, a reviewed one
and an approved one running on the satellite all need different places to sit.
Today there is one place, and it is the operator's laptop.

**People collide.** Several operators edit the same procedure locally and each
pushes a pull request. Nothing tells them someone else is in the file.

**The work happens outside MOS.** Writing, pushing and merging live in the
terminal and the git website. MOS never sees a procedure until it is finished,
so it cannot show its state, gate it, or record who did what.

## 3. Goals

1. An operator creates, writes, reviews, tests and approves a procedure from
   MOS, with no step in a terminal or a git website.
2. Every stage has a place to run: in-progress work in DEV, formal tests in
   TEST, approved procedures in PROD.
3. What runs in PROD is exactly what was approved — the same snapshot, not a
   later edit.
4. Two people never overwrite each other. Each works in their own copy, and
   keeps it after they submit.
5. MOS can always say which snapshot of every procedure is in which
   environment, and how it got there.
6. Formal test results mean something: they run on the same MOS build as PROD.

## 4. Non-goals

| Not in v1 | Why |
|---|---|
| MDB changes and their promotion | Own PRD. This PRD only requires environments to declare their MDB version. |
| MOS build promotion — D, S, P for the engine | Own PRD. This PRD only requires TEST to run the PROD build. |
| A release step between approval and PROD | Parked. Approved means available in PROD. |
| How snapshots are stored, identified and rolled back | Version Management PRD. |
| Which snapshot a scheduled pass sheet runs, and warning when that changes | Sheets reference the procedure and resolve when the sheet starts (DEC-044). The warning is the Impact and Dependency Analysis PRD. |
| Automated test execution | V2, per the lifecycle PRD. |
| Live co-editing of one file by two people | LEO-104 is On Hold. Separate copies, not shared cursors. |
| Who may do what in each environment | Role-based authorization PRD. |
| Which editor, git host or workspace manager | Product choices, not requirements. |
| Whether the editor is embedded in the MOS page or opened in its own tab | Frontend detail. Either satisfies goal 1. |
| A local-laptop workflow | Still possible for those who want it; not designed for, not supported here. |

## 5. User stories

**Author**

- I want to create a procedure from MOS and get a workspace with the right
  TM/TC library already there, so that I set nothing up.
- I want to write and save without ever seeing git, so that the tooling stays
  out of the way.
- I want to try my in-progress procedure against the simulator or flatsat from
  DEV, so that I find problems before anyone reviews it.
- I want my own copy while I work, and to keep it after I submit, so that
  review never stops my work.
- I want to submit for review from MOS, so that a frozen snapshot goes forward.

**Reviewer**

- I want to review exactly the snapshot that was submitted, so that what I
  pass can't change under me.

**Tester**

- I want TEST to run exactly the reviewed snapshot, on the PROD build, so that
  a pass means something.

**Approver**

- I want to see which snapshot passed review and test, so that I approve the
  thing that was tested.
- I want approval to make the snapshot available in PROD promptly, and
  supersede the previous one, so that there is never doubt about which version
  PROD has.
- I want to withdraw approval, so that a snapshot leaves PROD without the
  procedure being deleted.
- I want to re-approve a superseded snapshot, so that I can roll back without
  a review cycle.

**Console operator**

- I want PROD to see only approved snapshots, so that what I put in a pass
  sheet is what was approved.
- I want to run an approved snapshot in TEST to watch its behaviour, without
  changing its state.

**Anyone**

- I want to see which snapshot of a procedure is in which environment, so that
  I never have to ask.

## 6. Scope for v1

**In**

| | |
|---|---|
| Three environments | DEV, TEST, PROD |
| Hosted workspace | one per author per procedure, created from MOS, kept after submit |
| Snapshot on submit | review, test and approval all refer to it |
| Approval is the gate | an approved snapshot is available in PROD within a time bound; the previous one is superseded |
| Withdraw and re-approve | leave PROD, or roll back, without a review cycle |
| Where-is-it view | which snapshot is where — derived from state, nothing stored |
| TEST discipline | runs the PROD build |

**Out, and why**

| Item | Status |
|---|---|
| MDB promotion | Own PRD |
| MOS build promotion | Own PRD |
| Snapshot storage, identity, history | Version Management PRD |
| A release step after approval | Parked |
| Automated test execution | V2 |
| Per-environment permissions | Authorization PRD |
| Live co-editing | LEO-104 On Hold |
| Simulator interface | LEO-099 On Hold — DEV and TEST need a target; the one external dependency v1 cannot avoid |
| Local-laptop workflow | Not supported |

## 7. What it does

**The three environments**

DEV, TEST and PROD are labels for three guarantees, not a prescription for
three servers. Any arrangement that meets the guarantees satisfies this PRD.

| | DEV | TEST | PROD |
|---|---|---|---|
| MOS build | any released build | **the PROD build** | released |
| Runs against | simulator / flatsat | simulator / flatsat | the satellite, via MCS |
| Holds | working copies | the snapshot under test | approved snapshots only |
| Who works here | operators — authoring | operators — testing, approving | operators — on console |
| Who edits | authors | nobody | nobody |

**A procedure's journey**

One procedure, two snapshots, in order. Time runs down; place runs across.

| Step | Action | DEV | TEST | PROD |
|---|---|---|---|---|
| 1 | Create | working copy | — | — |
| 2 | Submit → snapshot **A** | working copy, still editable | A in review | — |
| 3 | Review and test pass | working copy | A tested | — |
| 4 | Approve A | working copy | — | **A** |
| 5 | Edit, submit → snapshot **B** | working copy | B in review | A |
| 6 | Review, test, approve B | working copy | — | **B** — A superseded |
| 7 | Withdraw B | working copy | — | nothing approved |
| 8 | Re-approve A — rollback | working copy | — | **A** |

The working copy never leaves DEV and is never blocked. Only PROD's column
answers "what can fly".

1. **Create.** From MOS, the author picks a name, a folder and a template. MOS
   makes a workspace on DEV with the generated TM/TC library present and opens
   the editor.
2. **Write and try.** Save as often as needed. Run it against the simulator or
   flatsat from DEV. Nothing here changes any state.
3. **Submit.** MOS freezes a snapshot. The workspace stays open and editable.
4. **Review.** The reviewer sees the snapshot — the same bytes, always.
5. **Test.** TEST checks out the snapshot onto the PROD build and runs it
   against the simulator or flatsat. The tester records the
   outcome.
6. **Approve.** PROD sees the snapshot within the time bound of R8. The previously approved
   snapshot, if any, is superseded. No further step.
7. **After approval.** Withdraw removes it from PROD. Re-approving a superseded
   snapshot is rollback. Either is one act by an approver.

**Where is it?** MOS shows, per procedure: the working copy on DEV and who has
it; any snapshot in TEST; the approved snapshot in PROD. Nothing is stored for
this — it follows from each snapshot's state.

**If PROD loses contact with the shared Procedure Library**, sheets already
running carry on. Once the time bound passes without contact, PROD starts no
new sheet — a withdrawal it could not hear must never fly (DEC-045).

## 8. Requirements

| # | Requirement | Traces to | Who may |
|---|---|---|---|
| R1 | MOS shall provide places to work that meet the guarantees in section 7, referred to here as DEV, TEST and PROD, and every action on a procedure shall be possible from MOS | no requirement — OQ-061 | — |
| R2 | Creating a procedure from MOS shall give the author a workspace on DEV with the generated TM/TC library for that environment's MDB version | LEO-069, LEO-073, LEO-074 | author |
| R3 | Each author shall have their own working copy of a procedure; no two authors share one | LEO-104, narrowed | author |
| R4 | Submit shall freeze a snapshot and leave the working copy editable | LEO-076, refined | author |
| R5 | Review, test and approval shall apply to the submitted snapshot and to nothing else | LEO-076, LEO-077, refined | reviewer, tester, approver |
| R6 | A procedure in any state shall be runnable from DEV against the simulator or flatsat; doing so shall change no state | LEO-099 — On Hold | author |
| R7 | TEST shall run the same MOS build as PROD | no requirement — OQ-061 | — |
| R8 | An approval or a withdrawal shall take effect in PROD within a time bound — UNRESOLVED — OQ-062 — with no restart and no further step. A withdrawn snapshot shall not be started after that bound; a sheet already running keeps the snapshots it started with (DEC-044) | LEO-079, refined | — |
| R9 | PROD shall hold approved snapshots only. Nothing shall be edited in TEST or PROD | LEO-077, refined | — |
| R10 | Every environment shall declare its MOS build and MDB version | no requirement — OQ-061 | — |
| R11 | MOS shall show, per procedure, which snapshot is in which environment | LEO-076, refined | any user |
| R12 | If PROD loses contact with the state authority, sheets already running shall continue, and no new sheet shall start once the time bound passes without contact | no requirement — OQ-061 | — |

## 9. Domain items touched

| Item | Kind | Read / written | Held by |
|---|---|---|---|
| `Procedure` | entity | written on create | MOS. How a procedure is identified — by its file path, which changes when the file moves, or by a stable ID that does not — is UNRESOLVED — OQ-060. |
| `ProcedureVersion` | entity — the snapshot | written on submit; read by TEST and PROD | MOS |
| `StateTransition` | record | read — to work out which snapshot is where | MOS |
| `Environment` | value set | read | MOS — DEV, TEST, PROD as labels (DEC-041) |
| `User` | external reference | read — who owns a workspace | identity provider |
| `Role` | entity | read | identity provider or MOS — unresolved |
| `Permission` | value set | read | MOS |

This PRD reads state and never changes it. The lifecycle PRD owns the
transitions.


## 10. Dependencies

**Other features**

| Feature | What this PRD needs from it | What breaks without it |
|---|---|---|
| Procedure lifecycle states | the snapshot states — submit, approve, withdraw | submit and approve mean nothing |
| Version Management | how snapshots are created, stored, identified and rolled back | "snapshot" has no mechanism behind it; OQ-060 stays open |
| Simulation | a way to run a procedure against the simulator or flatsat and get the result back | R6 and TEST runs have no target |
| Role-based authorization | who may create, edit, submit and approve, in which environment | anyone can approve into PROD |
| Execution | PROD runs approved snapshots only, never starts a withdrawn one (R8, R9) | this PRD makes the promise and nothing enforces it |
| Impact and dependency analysis | a warning when an approval or withdrawal changes what scheduled sheets will run | sheets change under operators without notice |
| MDB promotion | each environment's MDB version, and the right TM/TC library in each workspace (R2, R10) | authors write against the wrong telemetry and telecommand definitions |
| MOS build promotion | a defined "PROD build" for TEST to match (R7) | TEST results say nothing about PROD |

**External systems**

| System | Used for | What breaks without it |
|---|---|---|
| Hosted workspace product | authoring on DEV (R2, R3) | no place to write procedures |
| Simulator — Bifrost / FSW OBC simulator | trying in DEV, formal tests in TEST (R6) | nothing can be tried or tested |
| Flatsat | the hardware target beside the simulator | hardware behaviour is never tested; one box, so contention is possible |
| MCS | PROD's link to the satellite | PROD cannot fly anything |
| Identity provider | who owns each workspace and who took each action | no authorship, no audit |


## 11. Edge cases and failure modes

| Case | Behaviour |
|---|---|
| PROD loses contact with the state authority, and a withdrawal is made meanwhile | Safety wins. Once the time bound passes without contact, PROD starts no new sheet, so the withdrawn snapshot never starts. Sheets already running continue (DEC-045). Cost: a network fault can cost a pass. |

## 12. Open questions

| OQ | Question | Owner | Blocks |
|---|---|---|---|
| OQ-060 | Is a procedure identified by its file path or by a stable ID? | tech-lead | R4, R11, and "one approved snapshot per procedure" |
| OQ-062 | Within what time must an approval or a withdrawal take effect in PROD? | ops-team | R8 |

## 13. Acceptance criteria

| # | Given / when / then | Covers |
|---|---|---|
| A1 | Given an operator in MOS, when they create, edit, submit, review, test and approve a procedure, then no step needs a terminal or a git website | R1 |
| A2 | Given a new procedure created from MOS, when the workspace opens, then the TM/TC library matches DEV's declared MDB version | R2 |
| A3 | Given two authors on the same procedure, when one saves, then the other's working copy is unchanged | R3 |
| A4 | Given a submitted snapshot, when the author edits the working copy, then the snapshot is unchanged byte for byte and the working copy is still editable | R4 |
| A5 | Given snapshot A in review, when its working copy changes, then the reviewer, tester and approver still see A | R5 |
| A6 | Given a procedure in any state, when it is run from DEV against the simulator, then the run completes and no state changes | R6 |
| A7 | Given TEST on a different MOS build from PROD, when a formal test run is started, then it is refused | R7 |
| A8 | Given an approved snapshot, when it is withdrawn, then PROD does not start it after the time bound | R8 |
| A9 | Given a snapshot that is not approved, when anyone tries to place it in PROD, then it is refused. Given TEST or PROD, when an edit is attempted, then it is refused | R9 |
| A10 | Given any environment, when it is queried, then it reports its MOS build and MDB version | R10 |
| A11 | Given a procedure with a working copy, a snapshot in TEST and one approved, when its view is opened, then all three show in the right environments | R11 |
| A12 | Given a sheet running in PROD, when the state authority is taken offline, then the sheet runs to the end. Given a sheet scheduled to start after the time bound, when contact has not returned, then it does not start | R12 |

| Criterion | Cannot be fully tested until |
|---|---|
| A8 | OQ-062 sets the time bound |
| A6 | the Simulation PRD defines how a run against the simulator works |