# MOS prototype

A git-free mission-operations system for procedures. Operators write a procedure in a browser IDE, dry-run it against a
mock spacecraft, submit a frozen **snapshot**, and move it through **review, test and approval**. Exactly one snapshot per
procedure is *approved* (what PROD runs), rollback is one click, and every move is audited.

- Python runs **in the browser** (Pyodide in Web Workers). Nothing executes on a server.
- The lifecycle is enforced **in Postgres** (Supabase), not in the UI.
- Full design, diagrams, schema and trade-offs: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Quick start

### Prerequisites

| Need | Notes |
|---|---|
| Node.js >= 20.9 and npm | Tested on Node 26. `npm test` (vitest 5) needs Node 22.12+, 24 or 26+ |
| A Supabase project | Free tier is fine. You need its URL, a publishable key and a secret key |
| Internet during `npm install` | `postinstall` downloads two small Python wheels (jedi, parso) once; nothing is fetched from a CDN at runtime |
| `python3` | Only for `npm run catalog:build` and the lint unit tests (optional) |
| `uv` | **Only** for the optional Bifrost runner (see below) |

### 1. Environment variables

```bash
cp .env.example .env.local
```

| Variable | Required | Where to get it |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase dashboard -> Project Settings -> API -> **Project URL** |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes | Dashboard -> Project Settings -> API Keys -> **Publishable key** (`sb_publishable_...`) |
| `SUPABASE_SECRET_KEY` | yes | Dashboard -> Project Settings -> API Keys -> **Secret keys** -> create or reveal (`sb_secret_...`). Server only: never prefix with `NEXT_PUBLIC_` |
| `SUPABASE_DB_URL` | for `db:setup`, `db:drop`, `db:test` | Dashboard -> **Connect** -> **Session pooler** connection string (replace `[YOUR-PASSWORD]` with your database password) |
| `DEMO_MODE` | no (default `true`) | Shows one-click persona sign-in on `/login` and the persona switcher in the sidebar. Turn off for anything real |
| `DEMO_PASSWORD` | yes for `db:seed` and persona login | Any password you choose; the seed gives it to the demo personas. It never reaches the browser |
| `BIFROST_ENABLED` | no (default `false`) | `true` only if you set up the Bifrost runner |
| `BIFROST_BASE_URL` | Bifrost only | Defaults to `http://bifrost.pixxel.space` (Pixxel VPN required) |
| `BIFROST_WORKSPACE` | Bifrost only | Bifrost GUI -> your workspace name (shown in the URL / workspace switcher) |
| `BIFROST_API_TOKEN` | Bifrost only | Bifrost GUI -> Settings -> API -> workspace token (`bfk_...`) |
| `MOS_FRAMEWORK_PATH` | Bifrost only | Local checkout of `mos-framework`; it is copied, never modified |

### 2. Install, migrate, seed, run

```bash
npm install            # also runs the vendor-assets postinstall (Pyodide, Monaco, Ruff -> public/vendor/)
npm run db:setup       # applies supabase/migrations/*.sql to SUPABASE_DB_URL (tracked in _mos_migrations)
npm run db:seed        # creates 6 demo users, 20 procedures with histories, 32 snapshots (idempotent)
npm run dev            # http://localhost:3000
```

Open <http://localhost:3000>. On `/login` pick a persona (all share the `DEMO_PASSWORD` from your `.env.local`). Switch
persona any time from the user menu at the bottom of the sidebar.

> `npm run db:seed` **wipes** the demo tables and the `procedure-code` bucket before inserting. Never point it at a
> database holding real data. `npm run db:setup -- --status` shows applied vs pending migrations without changing anything.

### Personas

| Persona | Roles | Use them to |
|---|---|---|
| Asha Rao | author | Write and dry-run procedures |
| Rohan Mehta | author | A second author who collides with Asha on the same procedure |
| Meera Iyer | reviewer, author | Review code before it goes to test |
| Kabir Singh | tester | Run snapshots and record results |
| Nisha Verma | approver | Clear for flight, roll back, withdraw, retire |
| Dev Kapoor | admin (every role) | Manage roles, toggle "allow self actions" |

Emails are `<first>.<last>@mos.test` (see `lib/personas.ts`).

## 5-minute demo for operators

Use the procedure `FF_AXX_FCP_EPS_181_Set_solar_panel_string_3_shunt_threshold` (Asha has working copy #3 on it).

| # | Persona | Where | What to do | What to point out |
|---|---|---|---|---|
| 0 | any | `/login` then `/` | Sign in; look at **My queue** and the PROD panel | "What needs me?" is the landing page; stale items are flagged after 5 days |
| 1 | **Asha** (author) | My queue -> EPS_181 #3 -> IDE (`/snapshots/<id>/edit`) | Type `comm.` and see completions; mistype a command name and see the red "not a command in the FF MDB" squiggle with a fix. In the Run panel use **Faults -> Inject -> Which command fails?** and pick the set-threshold command (`EPSSetSlrPnl3Thrld`), set warp to instant, press **Run** (Cmd+Enter). When the prompt appears press **1** (Retry command) | Same imports as production; no laptop, no git; the old terminal prompt is now a button; virtual clock, telemetry inspector, timeline |
| 2 | Asha | IDE -> **Submit for review** | Review the pre-flight checks and the diff, write a change summary, keep "continue in a fresh working copy" ticked, submit | Auto-fork: the submitted snapshot is frozen and you are already in a new working copy. On the snapshot page note **SHA-256 verified** |
| 3 | **Meera** (reviewer) | My queue -> the new snapshot -> **Review** tab | Click a line number to leave a line comment; **Pass review**. (Try as Asha: the button is disabled with the reason "can't review your own snapshot") | Separation of duties is enforced by the database |
| 4 | **Kabir** (tester) | My queue -> snapshot -> **Test** tab | **Dry run this snapshot** (inject a fault if you like), come back, add a test case, attach the run as evidence, then **Record tests passed** | The approver will see exactly this evidence chain |
| 5 | **Nisha** (approver) | My queue -> snapshot -> **Approval** tab | Read "What changes in PROD" and the diff against the active snapshot, then **Approve for PROD** (type `APPROVE`) | The previous active snapshot becomes **Superseded** automatically; only one can be approved |
| 6 | Nisha | Snapshot page of the new active snapshot | **Withdraw approval**: choose the fallback snapshot, give a reason, type `ROLLBACK`. For a plain rollback use **Reactivate (rollback)** on a superseded snapshot | The active snapshot cannot be withdrawn directly: MOS reactivates another one first, then withdraws, as two audited steps |
| 7 | **Dev** or anyone | `/audit` | Filter by procedure, **export CSV**. In **Incident lookup** pick `FF_AXX_CRP_FSW_04_Soft_Reset_of_Active_OBC_by_ARB` and a time about 12 days ago (snapshot 3 was live), then one about 5 days ago (after the seeded rollback) | "Which version ran, who reviewed it, who tested it, who cleared it for flight" answered in one view |

After `npm run bifrost:seed` (and Bifrost set up) the JTYU procedures also appear; run one on a live sim from the IDE.

Extras: sign in as Asha and Rohan in two browsers and open the same procedure to see presence; as Dev, open **Admin**
and toggle self actions to run the whole pipeline solo; the **TM/TC catalog** page lists all 1,748 FF commands and 3,890
parameters; the procedure page's PROD lane and history strip answer "what was active at time T".

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on port 3000 (Turbopack) |
| `npm run build` / `npm start` | Production build and server |
| `npm run lint` | ESLint |
| `npm test` | Vitest unit tests |
| `npm run test:runtime` | Shim + mock spacecraft tests in Node (Pyodide) |
| `npm run test:seeds` | Offline check: every seed procedure lints clean, uses real catalog names and completes on the mock spacecraft; seed history replays through the lifecycle rules |
| `npm run db:test` | Lifecycle acceptance tests against your Supabase database (PRD-001 A1-A15, A17, separation of duties, a two-connection concurrency race; 19 scenarios). Needs `SUPABASE_DB_URL` |
| `python3 scripts/test_mos_lint.py` | Unit tests of the MOS lint rules (MOS000-MOS009) |
| `npm run db:setup` | Apply migrations (`-- --status` to only list them) |
| `npm run db:seed` | Seed demo users, procedures and histories (`-- --dry-run` validates locally) |
| `npm run db:drop` | Dry listing of what would be dropped; add `-- --yes` to drop, `--users` to delete the demo auth users too |
| `npm run vendor` | (Re)copy Pyodide, Monaco and Ruff into `public/vendor/`; also regenerates `public/py/manifest.json`. Runs automatically as `postinstall` |
| `npm run catalog:build` | Rebuild `public/catalog/<mission>.json` from a mos-framework checkout (`scripts/build_catalog.py`) |
| `npm run bifrost:setup` | Prepare the optional runner: copy the framework, `uv sync` Python 3.12, install |
| `npm run bifrost:gen-mdb` | Generate the Jatayu TM/TC library from a RUNNING Bifrost sim and rebuild `public/catalog/jtyu.json` |
| `npm run bifrost:sim -- list \| status <id> \| start [seconds] \| stop <id>` | Small CLI over the Bifrost API |
| `npm run bifrost:test` | Live end-to-end check of the Jatayu seed procedures on a Bifrost sim |
| `npm run bifrost:seed` | Add the 3 Jatayu demo procedures (`seed/procedures/jtyu/`) with histories; run after `db:seed`, idempotent |
| `npx tsx scripts/bifrost-test-http.ts [base-url]` | Checks the `/api/bifrost` routes of a running dev server (needs `BIFROST_ENABLED=true`, a RUNNING sim, `bifrost:seed`) |

## Optional: Bifrost (Jatayu only)

Runs a Jatayu procedure **on the server** with the real mos-framework against a live Bifrost simulation, from the same
IDE console. Needs the Pixxel VPN, a workspace token and a RUNNING simulation (the IDE's sim picker can also start one
short real-time sim). Bifrost simulates Jatayu only, so Firefly procedures cannot use it.

```bash
brew install uv
# in .env.local: BIFROST_ENABLED=true, BIFROST_WORKSPACE, BIFROST_API_TOKEN, MOS_FRAMEWORK_PATH
npm run bifrost:setup          # copy the framework to runner/.work, uv sync Python 3.12 into runner/.venv
npm run bifrost:gen-mdb        # optional: regenerate the Jatayu catalog from a RUNNING sim
npm run bifrost:seed           # after db:seed: adds JTYU_SYS_001, JTYU_SYS_002, JTYU_THM_003
npm run bifrost:test           # optional live check on a sim
```

Then open a JTYU procedure in the IDE, choose the **Bifrost (Jatayu SILS)** run target, attach a simulation in its
panel and Run. The target is offered only when the procedure's mission is `JTYU` and `BIFROST_ENABLED=true`; with the flag
off every `/api/bifrost` route returns 404. Limits: real time only, one active run per user, run registry is in memory
(lost on a Next restart), a stopped run can leave the spacecraft mid-procedure, the per-run YAMCS is unauthenticated, and
the runner is not a sandbox. Details and the live verification results: section 9 of
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## What gets installed locally

| What | Where | Removal |
|---|---|---|
| npm packages | `node_modules/` | delete the folder |
| Vendored browser assets (Pyodide, Monaco, Ruff, jedi wheels; about 53 MB) | `public/vendor/` (gitignored) | delete the folder |
| Supabase data: tables, functions, bucket `procedure-code`, demo users | your Supabase project | `npm run db:drop -- --yes` (and `--users` for the demo auth users), or delete the Supabase project. The `citext` extension is left in place |
| **Bifrost only:** `uv`, the Python 3.12 it manages, `runner/.venv`, `runner/.work` | Homebrew, `~/.local/share/uv`, `~/.cache/uv`, the repo | see below |

No Docker, no global Python packages, no databases on your machine.

### Uninstall / clean up

```bash
# 1. Remove the Supabase side first (needs .env.local)
npm run db:drop -- --yes --users

# 2. Bifrost only (and set BIFROST_ENABLED=false)
rm -rf runner/.venv runner/.work
uv python uninstall 3.12        # or: rm -rf ~/.local/share/uv
rm -rf ~/.cache/uv
brew uninstall uv

# 3. Delete the project folder
cd .. && rm -rf mos-prototype
```

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| "The page is not cross-origin isolated ..." or runs never start | `window.crossOriginIsolated` is false. The app must be served with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` (set in `next.config.ts`). A reverse proxy or hosting layer that strips these headers breaks it; also check `crossOriginIsolated` in the browser console |
| Editor blank, or "Python intelligence loading" never finishes, or 404s under `/vendor` | Vendored assets are missing (a failed or offline `postinstall` does not fail the install). Run `npm run vendor` |
| `npm run vendor` fails downloading wheels | It fetches jedi/parso from `cdn.jsdelivr.net` once (sha256-verified). Check network/proxy and retry |
| Login works but pages show database errors | Migrations are not applied: `npm run db:setup -- --status`, then `npm run db:setup` |
| "Missing SUPABASE_DB_URL" | Add the Session pooler connection string to `.env.local` (Dashboard -> Connect) |
| Persona buttons missing on `/login` | `DEMO_MODE` is not `true` in `.env.local` (restart `npm run dev` after editing it) |
| Persona login says invalid credentials | Run `npm run db:seed` again; it resets the demo users' password to your current `DEMO_PASSWORD` |
| Bifrost calls fail with "Cannot reach Bifrost" | Connect to the Pixxel VPN; check `BIFROST_BASE_URL`, workspace and token |
| Bifrost run says the runner is not installed | Run `npm run bifrost:setup` (needs `uv` and `MOS_FRAMEWORK_PATH`) |
| No Bifrost target in the IDE | The procedure must be mission `JTYU` and `BIFROST_ENABLED=true` (restart `npm run dev` after editing `.env.local`) |
| `npm test` complains about the Node version | vitest 5 needs Node 22.12+, 24 or 26+ |

## Project layout (short)

`app/` routes and server actions - `components/mos/` app UI (IDE in `components/mos/ide/`) - `lib/` clients, lifecycle,
editor and sandbox logic - `workers/` language and run Web Workers - `public/py/` Python shim of mos-framework, mock
spacecraft and lint rules - `public/catalog/` TM/TC catalogs - `supabase/migrations/` schema and lifecycle RPCs -
`seed/` demo data - `runner/` optional Bifrost runner. The annotated tree is in section 12 of
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

> This project runs Next.js 16.4.2, which has breaking changes compared with earlier versions; before touching framework APIs read
> `AGENTS.md` and `node_modules/next/dist/docs/`.
