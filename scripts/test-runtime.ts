/**
 * Headless test of the Python shim + mos_sim in Node (Pyodide from node_modules).
 * The JS bridge is implemented synchronously here: sleep is a no-op, prompts are answered from a script.
 *
 *   npm run test:runtime
 */
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPyodide } from 'pyodide';
import { buildPyManifest } from './py-manifest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

interface Ev {
  type: string;
  t?: number;
  [k: string]: unknown;
}
interface Result {
  outcome: string;
  error: string | null;
  traceback: string | null;
  returnValue: string | null;
  virtualSeconds: number;
  wallMs: number;
}

// ---- bridge state (reset per test) ---------------------------------------------------------
let events: Ev[] = [];
let answers: string[] = [];
let prompts: Ev[] = [];
let mailbox: object[] = [];
let pumpCount = 0;
let interruptAtPump = Infinity;
let mailboxAtPump: Record<number, object[]> = {};

const bridge = {
  emit(json: string) {
    const v = JSON.parse(json);
    if (Array.isArray(v)) events.push(...v);
    else events.push(v);
  },
  sleep() {
    return false;
  },
  prompt(json: string) {
    const ev = JSON.parse(json) as Ev & { choices: string[] };
    prompts.push(ev);
    events.push(ev);
    const a = answers.shift();
    if (a === undefined) return -1;
    const i = ev.choices.indexOf(a);
    if (i < 0) throw new Error(`scripted answer ${JSON.stringify(a)} is not one of ${JSON.stringify(ev.choices)}`);
    return i;
  },
  read_mailbox() {
    const extra = mailboxAtPump[pumpCount];
    if (extra) mailbox.push(...extra);
    if (!mailbox.length) return '';
    const out = JSON.stringify(mailbox);
    mailbox = [];
    return out;
  },
  interrupted() {
    pumpCount++;
    return pumpCount >= interruptAtPump;
  },
};

const FIX = {
  eps: read('scripts/fixtures/FF_AXX_FCP_EPS_181_Set_solar_panel_string_3_shunt_threshold.py'),
  fsw: read('scripts/fixtures/FF_AXX_CRP_FSW_04_Soft_Reset_of_Active_OBC_by_ARB.py'),
};

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: unknown, detail?: unknown) {
  if (cond) passed++;
  else {
    failures.push(name + (detail === undefined ? '' : ` -> ${typeof detail === 'string' ? detail : JSON.stringify(detail, null, 1)}`));
    console.log(`  FAIL ${name}`);
  }
}

async function main() {
  const manifest = buildPyManifest();
  const pyodide = await loadPyodide();
  pyodide.registerJsModule('mos_bridge', bridge);

  // python shim into the FS
  const base = '/home/pyodide/mos';
  for (const f of manifest.files) {
    pyodide.FS.mkdirTree(dirname(`${base}/${f}`));
    pyodide.FS.writeFile(`${base}/${f}`, read(`public/py/${f}`));
  }
  const catalogPath = existsSync(join(root, 'public/catalog/ff.json')) ? 'public/catalog/ff.json' : 'public/catalog/__fixture.json';
  console.log(`catalog: ${catalogPath}`);
  pyodide.FS.mkdirTree('/catalog');
  pyodide.FS.writeFile('/catalog/ff.json', read(catalogPath));
  pyodide.FS.mkdirTree('/sim');
  pyodide.FS.writeFile('/sim/ff-sim.json', read('public/sim/ff-sim.json'));
  pyodide.runPython(`import sys\nsys.path.insert(0, ${JSON.stringify(base)})`);
  const runner = pyodide.pyimport('mos_sim.runner');
  const info = pyodide.pyimport('mos_sim.procedure_info');

  interface RunOpts {
    entry?: string;
    args?: Record<string, unknown>;
    faults?: object[];
    answers?: string[];
    telemetry?: Record<string, unknown>;
    warp?: number | string;
    sim?: object;
  }
  function run(code: string, o: RunOpts = {}): Result {
    events = [];
    prompts = [];
    mailbox = [];
    answers = [...(o.answers ?? [])];
    pumpCount = 0;
    const req = {
      code,
      entrypoint: o.entry,
      args: o.args ?? {},
      mission: 'FF',
      options: { warp: o.warp ?? 'inf', faults: o.faults ?? [], telemetry: o.telemetry, sim: o.sim },
    };
    return JSON.parse(runner.run(JSON.stringify(req))) as Result;
  }
  const logs = () => events.filter((e) => e.type === 'log' && e.logger === 'run').map((e) => String(e.msg));
  const cmdStatuses = () => events.filter((e) => e.type === 'command').map((e) => `${e.cls}:${e.status}`);
  const dump = (label: string) => { if (process.env.DUMP) console.log(`--- ${label}\n` + events.map((e) => JSON.stringify(e)).join('\n')); };
  const section = (s: string) => console.log(`- ${s}`);

  // ------------------------------------------------------------------------------------------
  section('inspect');
  {
    const sig = JSON.parse(info.inspect_json(FIX.eps, 'FF', null));
    check('inspect eps entrypoint', sig.entrypoint === 'Set_solar_panel_string_3_shunt_threshold_Procedure', sig);
    check('inspect eps params', sig.params.length === 2 && sig.params[0].kind === 'str' && sig.params[1].kind === 'float' && sig.params[1].required, sig);
    const sig2 = JSON.parse(info.inspect_json(FIX.fsw, 'FF', null));
    const p = sig2.params[0];
    check('inspect fsw enum', p.kind === 'enum' && p.enum === 'PusAckFlagsEnum' && p.members.length === 4 && p.annotation === 'comm.PusAckFlagsEnum', sig2);
    const bad = JSON.parse(info.inspect_json('def f(:\n', 'FF', null));
    check('inspect syntax error', /SyntaxError/.test(bad.error), bad);
    const multi = JSON.parse(info.inspect_json('def a(x: int): pass\ndef b(y: str = "q"): pass\n', 'FF', null));
    check('inspect multiple functions', multi.entrypoint === null && multi.candidates.length === 2 && multi.error, multi);
    const opt = JSON.parse(info.inspect_json('from typing import Optional, List\ndef a(x: Optional[int] = None, ys: List[int] = [1], flag: bool = True): pass\n', 'FF', null));
    check('inspect optional/list/bool', opt.params[0].kind === 'int' && opt.params[0].optional && opt.params[1].kind === 'list' && opt.params[2].default === true, opt);
  }

  // ------------------------------------------------------------------------------------------
  section('EPS_181 green path');
  {
    const r = run(FIX.eps, { args: { Pus_Acknowledgement_Flags: 'Acceptance | Completion', Threshold: '3.2' } });
    check('eps completed', r.outcome === 'completed', r);
    check('eps final log', logs().some((l) => l.includes('Shunt threshold of solar panel string 3 successfully set to 3.2')), logs());
    check('eps no prompts', prompts.length === 0);
    check('eps commands', cmdStatuses().join(',') ===
      'EPSGetSlrPnlThrld:issued,EPSGetSlrPnlThrld:completed,EPSSetSlrPnl3Thrld:issued,EPSSetSlrPnl3Thrld:completed,EPSGetSlrPnlThrld:issued,EPSGetSlrPnlThrld:completed', cmdStatuses());
    const issued = events.find((e) => e.type === 'command' && e.cls === 'EPSSetSlrPnl3Thrld') as Ev & { args: Record<string, unknown> };
    check('eps command args', issued.args.Pus_Acknowledgement_Flags === 'Acceptance | Completion' && issued.args.Threshold === 3.2 && 'Command_Timetag' in issued.args, issued.args);
    const tm = events.filter((e) => e.type === 'telemetry').pop() as Ev & { values: Record<string, unknown> };
    check('eps telemetry snapshot', tm?.values['/FF/EPS/slrPnl3ShntThd_Vol'] === 3.2 && tm.values['/MOS/CommandCounter'] === 3, tm?.values);
    check('eps virtual time', r.virtualSeconds > 1 && r.virtualSeconds < 10, r.virtualSeconds);
    const again = run(FIX.eps, { args: { Pus_Acknowledgement_Flags: 'Acceptance | Completion', Threshold: 3.0 } });
    check('eps already set', again.outcome === 'completed' && logs().some((l) => l.includes('is already 3.0')), logs());
  }

  section('FSW_04 green path');
  {
    const r = run(FIX.fsw, { args: { Pus_Acknowledgement_Flags: 'Acceptance | Completion' } });
    dump('fsw');
    check('fsw completed', r.outcome === 'completed', r);
    const l = logs().join('\n');
    check('fsw counter log', l.includes('OBC reset counter increased by 1'), l);
    check('fsw uptime log', /OBC uptime: \d+/.test(l) && !l.includes("didn't"), l);
    check('fsw reason log', l.includes('Last reset reason: BM_LAST_RESET_TYPE_SOFT_RST'), l);
    check('fsw no errors', !events.some((e) => e.type === 'log' && e.level === 'error'), events.filter((e) => e.level === 'error'));
    const tms = events.filter((e) => e.type === 'tm' && e.fresh);
    check('fsw fresh tm events', tms.length === 6, tms.length);
    const byName = run(FIX.fsw, { args: { Pus_Acknowledgement_Flags: 'ACCEPTANCE' } });
    check('fsw enum by name', byName.outcome === 'completed', byName);
  }

  // ------------------------------------------------------------------------------------------
  section('command_fails -> Retry');
  {
    const r = run(FIX.eps, {
      args: { Pus_Acknowledgement_Flags: 'Acceptance | Completion', Threshold: 3.2 },
      faults: [{ kind: 'command_fails', match: '', once: true }],
      answers: ['1: Retry command'],
    });
    check('retry completed', r.outcome === 'completed', r);
    check('retry one prompt', prompts.length === 1, prompts.length);
    check('retry prompt text', prompts[0]?.message === 'Command completion verfication did NOT happen as expected. How do you want to proceed: ', prompts[0]);
    check('retry prompt choices', JSON.stringify(prompts[0]?.choices) === JSON.stringify([
      '1: Retry command', '2: Continue rest of the procedure', '3. Skip rest of the procedure',
      '4. Choose specific procedure to resume from', '5: Stop execution']), prompts[0]?.choices);
    check('retry statuses', cmdStatuses().slice(0, 4).join(',') === 'EPSGetSlrPnlThrld:issued,EPSGetSlrPnlThrld:failed,EPSGetSlrPnlThrld:issued,EPSGetSlrPnlThrld:completed', cmdStatuses());
    const skip = run(FIX.eps, {
      args: { Pus_Acknowledgement_Flags: 'Acceptance | Completion', Threshold: 3.2 },
      faults: [{ kind: 'command_fails', match: 'Get_slrPnl', once: false }],
      answers: ['3. Skip rest of the procedure'],
    });
    check('skip outcome', skip.outcome === 'skipped', skip);
    const choose = run(FIX.eps, {
      args: { Pus_Acknowledgement_Flags: 'Acceptance | Completion', Threshold: 3.2 },
      faults: [{ kind: 'command_fails', match: '', once: true }],
      answers: ['4. Choose specific procedure to resume from'],
    });
    check('choose outcome', choose.outcome === 'choose', choose);
    const cont = run(FIX.eps, {
      args: { Pus_Acknowledgement_Flags: 'Acceptance | Completion', Threshold: 3.2 },
      faults: [{ kind: 'command_fails', match: '', once: true }],
      answers: ['2: Continue rest of the procedure'],
    });
    check('continue outcome', cont.outcome === 'completed', cont);
  }

  section('command_timeout');
  {
    const r = run(FIX.eps, {
      args: { Pus_Acknowledgement_Flags: 'Acceptance | Completion', Threshold: 3.2 },
      faults: [{ kind: 'command_timeout', match: 'Set_slrPnl3', once: true }],
      answers: ['1: Retry command'],
    });
    check('timeout completed after retry', r.outcome === 'completed', r);
    check('timeout status event', cmdStatuses().includes('EPSSetSlrPnl3Thrld:timeout'), cmdStatuses());
    check('timeout waited virtual time', r.virtualSeconds >= 30, r.virtualSeconds);
  }

  section('freeze_param / drop_param');
  {
    const r = run(FIX.fsw, {
      args: { Pus_Acknowledgement_Flags: 'Acceptance | Completion' },
      faults: [{ kind: 'freeze_param', q: '/FF/OBC/Reset_Counter' }],
      answers: ['5: Stop execution'],
    });
    check('freeze stopped', r.outcome === 'stopped', r);
    check('freeze prompt', prompts.length === 1 && String(prompts[0].message).startsWith('Reading FRESH value of parameter `/FF/OBC/Reset_Counter` returned NONE'), prompts[0]);
    check('freeze waited timeout', r.virtualSeconds >= 10 && r.virtualSeconds < 11, r.virtualSeconds);
    const retry = run(FIX.fsw, {
      args: { Pus_Acknowledgement_Flags: 'Acceptance | Completion' },
      faults: [{ kind: 'drop_param', q: '/FF/OBC/Reset_Counter' }],
      answers: ['1: Retry reading parameter', '3. Skip rest of the procedure'],
    });
    check('drop retry then skip', retry.outcome === 'skipped' && prompts.length === 2, { retry, n: prompts.length });
    // production quirk: "2: Continue ..." in read_fresh_parameter_value falls through to StopExecutionError
    const cont = run(FIX.fsw, {
      args: { Pus_Acknowledgement_Flags: 'Acceptance | Completion' },
      faults: [{ kind: 'freeze_param', q: '/FF/OBC/Reset_Counter' }],
      answers: ['2: Continue rest of the procedure (the rest of the procedure might break if you are using the returned value)'],
    });
    check('read_fresh continue quirk', cont.outcome === 'stopped', cont);
  }

  // ------------------------------------------------------------------------------------------
  section('command construction / coercion');
  {
    const code = `
import framework.ff.commands as comm
import framework.ff.parameters as param
import enum

def Check():
    c = comm.EPSSetSlrPnl3Thrld(Pus_Acknowledgement_Flags=comm.PusAckFlagsEnum.ACCEPTANCE___COMPLETION, Threshold="3.5")
    assert c.command_arguments['Threshold'] == 3.5, c.command_arguments
    assert c.command_arguments['Pus_Acknowledgement_Flags'] == 'Acceptance | Completion'
    assert c.qualified_name == '/FF/EPS/Set_slrPnl3_Thrld' == c.field_qualified_name_
    assert c.formatted_name == c.qualified_name
    assert '\\x1b' not in c.formatted_arguments
    for raw in ('Acceptance | Completion', 'acceptance | completion', 'ACCEPTANCE___COMPLETION', comm.PusAckFlagsEnum.ACCEPTANCE___COMPLETION):
        d = comm.EPSSetSlrPnl3Thrld(Pus_Acknowledgement_Flags=raw, Threshold=1)
        assert d.Pus_Acknowledgement_Flags is comm.PusAckFlagsEnum.ACCEPTANCE___COMPLETION
    assert issubclass(comm.PusAckFlagsEnum, enum.Enum) and comm.PusAckFlagsEnum('None') is comm.PusAckFlagsEnum.NONE
    for bad, exc in (
        (dict(Pus_Acknowledgement_Flags='x', Threshold=1), ValueError),
        (dict(Threshold=1), ValueError),
        (dict(Pus_Acknowledgement_Flags='None'), ValueError),
        (dict(Pus_Acknowledgement_Flags='None', Threshold='abc'), ValueError),
        (dict(Pus_Acknowledgement_Flags='None', Threshold=1, Treshold=2), TypeError),
    ):
        try:
            comm.EPSSetSlrPnl3Thrld(**bad)
        except exc as e:
            assert 'EPSSetSlrPnl3Thrld' in str(e), str(e)
        else:
            raise AssertionError('expected %s for %r' % (exc.__name__, bad))
    p = param.OBCResetCounter()
    assert p.qualified_name == '/FF/OBC/Reset_Counter' and p.Reset_Counter is None and p.generation_time is None
    assert 'OBCResetCounter' in dir(param) and 'PusAckFlagsEnum' in dir(comm)
    from framework.ff.commands import EPSGetSlrPnlThrld
    assert EPSGetSlrPnlThrld is comm.EPSGetSlrPnlThrld
    try:
        comm.EPSGetSlrPnlThrldd
    except AttributeError as e:
        assert 'Did you mean' in str(e), str(e)
    import framework.utils.commanding as ucomm
    t = ucomm.create_utc_time('2026-04-21T07:41:47.5Z')
    assert t.tzinfo is not None and t.hour == 7 and t.microsecond == 500000, t
    from framework.settings import settings
    assert settings.INSTANCE.split('-')[0] == 'ff1'
    print('construct ok')
`;
    const r = run(code, { entry: 'Check' });
    check('construction checks', r.outcome === 'completed' && events.some((e) => e.type === 'stdout' && e.text === 'construct ok'), r);
  }

  section('virtual clock + errors + stdout');
  {
    const code = `
import time
import datetime
from datetime import datetime as dt, timezone

def Clock(n: int = 100):
    t0 = time.time(); d0 = dt.now(timezone.utc); m0 = time.monotonic()
    time.sleep(n)
    assert abs((time.time() - t0) - n) < 1e-6, time.time() - t0
    assert abs((dt.now(timezone.utc) - d0).total_seconds() - n) < 1e-3
    assert abs((time.monotonic() - m0) - n) < 1e-6
    assert isinstance(d0, dt)
    print("slept", n)
    return n
`;
    const r = run(code, { args: { n: '100' } });
    check('virtual sleep', r.outcome === 'completed' && r.virtualSeconds === 100 && r.returnValue === '100' && r.wallMs < 2000, r);
    check('stdout event', events.some((e) => e.type === 'stdout' && e.text === 'slept 100'));
    const sleepType = pyodide.runPython('import time; time.sleep.__module__ + ":" + time.sleep.__qualname__');
    check('time.sleep restored', sleepType === 'time:sleep' || sleepType === 'pyodide._core.sleep', sleepType);
    check('time.time restored', pyodide.runPython('import time; abs(time.time() - __import__("time").time()) < 5 and time.time() > 1.7e9'));
    const dtType = pyodide.runPython('import datetime; datetime.datetime.__module__');
    check('datetime restored', dtType === 'datetime', dtType);
    const err = run('def F(x: int):\n    return 1 / x\n', { args: { x: 0 } });
    check('error outcome', err.outcome === 'error' && /ZeroDivisionError/.test(err.error ?? '') && /File "procedure.py", line 2, in F/.test(err.traceback ?? ''), err);
    const miss = run('def F(x: int):\n    return x\n');
    check('missing arg', miss.outcome === 'error' && /Missing required argument 'x'/.test(miss.error ?? ''), miss);
    const typed = run('from typing import List\ndef F(a: List[int], b: bool, c: float):\n    return (sum(a), b, c)\n', { args: { a: '[1,2,3]', b: 'false', c: '2' } });
    check('arg conversion', typed.outcome === 'completed' && typed.returnValue === '(6, False, 2.0)', typed);
    const syn = run('def F(:\n');
    check('syntax error', syn.outcome === 'error' && /SyntaxError/.test(syn.error ?? ''), syn);
    const stop = run('from framework.utils.custom_exceptions import StopExecutionError\ndef F():\n    raise StopExecutionError\n');
    check('StopExecutionError -> stopped', stop.outcome === 'stopped', stop);
    const imp = run('import nonexistent_mod\ndef F():\n    pass\n');
    check('import error', imp.outcome === 'error' && /ModuleNotFoundError/.test(imp.error ?? ''), imp);
  }

  section('stop / mailbox / warp');
  {
    interruptAtPump = 50;
    const stopped = run('import time\ndef F():\n    while True:\n        time.sleep(1)\n');
    check('interrupt -> stopped', stopped.outcome === 'stopped', stopped);
    interruptAtPump = Infinity;

    // telemetry override delivered through the mailbox while the procedure polls
    mailboxAtPump = { 8: [{ kind: 'telemetry', q: '/FF/OBC/Reset_Counter', value: 99 }] };
    const code = `
import framework.ff.parameters as param
def F():
    p = param.OBCResetCounter()
    for _ in range(50):
        if p.read_fresh_parameter_value() == 99:
            return "seen"
    return "never"
`;
    const r = run(code);
    mailboxAtPump = {};
    check('mailbox telemetry override', r.outcome === 'completed' && r.returnValue === "'seen'", r);

    // initial overrides via options
    const r2 = run(`import framework.ff.parameters as param\ndef F():\n    return param.OBCResetCounter().read_latest_parameter_value()\n`, { telemetry: { '/FF/OBC/Reset_Counter': 7 } });
    check('options.telemetry', r2.returnValue === '7', r2);

    // faults toggled through the mailbox: freeze, then clear
    mailboxAtPump = { 3: [{ kind: 'faults', faults: [{ kind: 'freeze_param', q: '/FF/OBC/Reset_Counter' }] }], 9: [{ kind: 'faults', faults: [] }] };
    const r3 = run(`import framework.ff.parameters as param\ndef F():\n    p = param.OBCResetCounter()\n    for _ in range(12):\n        p.read_fresh_parameter_value(timeout=1, fail_fast=True)\n    return 1\n`);
    mailboxAtPump = {};
    check('fault toggle via mailbox (stops while frozen)', r3.outcome === 'stopped', r3);

    // finite warp requests real waiting through bridge.sleep
    let slept = 0;
    bridge.sleep = () => {
      slept++;
      return false;
    };
    const r4 = run('import time\ndef F():\n    time.sleep(2)\n', { warp: 10 });
    check('finite warp calls bridge.sleep', r4.outcome === 'completed' && slept >= 4 && r4.virtualSeconds === 2, { slept, r4 });
  }

  section('sim effects');
  {
    const sim = {
      initial: { '/FF/OBC/Reset_Counter': 5 },
      effects: [
        { command: '/FF/EPS/Get_slrPnl_Thrld', delay: 2, set: { '/FF/OBC/Reset_Counter': { expr: 'prev * 2 + 1' } }, then: [{ after: 3, set: { '/FF/OBC/Uptime': 777 } }] },
        { command: 'EPSSetSlrPnl3Thrld', when: { Threshold: [9.9, 8.8] }, fail: true },
      ],
    };
    const code = `
import time
import framework.ff.commands as comm, framework.ff.parameters as param
from framework.utils.custom_exceptions import StopExecutionError
def F():
    comm.EPSGetSlrPnlThrld(Pus_Acknowledgement_Flags='None').execute_await_completion()
    assert param.OBCResetCounter().read_latest_parameter_value() == 11
    assert param.OBCUptime().read_latest_parameter_value() != 777
    time.sleep(3.2)
    assert param.OBCUptime().read_fresh_parameter_value() == 777
    r = comm.EPSSetSlrPnl3Thrld(Pus_Acknowledgement_Flags='None', Threshold=9.9).execute_await_completion_no_prompt(fail_fast=False)
    assert r[0] is False, r
    ok = comm.EPSSetSlrPnl3Thrld(Pus_Acknowledgement_Flags='None', Threshold=1.1).execute_await_completion_no_prompt()
    assert ok[0] is True and ok[1] == 'success'
    ok = comm.EPSGetSlrPnlThrld(Pus_Acknowledgement_Flags='None').execute_check_tm_until_special(param.OBCResetCounter(), 23)
    assert ok[:2] == (True, 'success'), ok
`;
    const r = run(code, { sim, entry: 'F' });
    check('sim effects (expr/then/when/fail/special paths)', r.outcome === 'completed', r);
  }

  console.log(`\n${passed} checks passed, ${failures.length} failed`);
  for (const f of failures) console.log(' - ' + f);
  mkdirSync(join(root, 'public', 'py'), { recursive: true });
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
