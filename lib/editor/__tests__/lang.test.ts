/**
 * Node-side tests for the language stack: Ruff wasm (config + diagnostics + formatter) and the
 * Pyodide path (mos_lint checks + jedi intelligence), mirroring what workers/lang.worker.ts does.
 * Pyodide tests are skipped when public/vendor/pyodide has not been vendored (`npm run vendor`).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { RUFF_SETTINGS } from '../ruff-settings';

const ROOT = resolve(__dirname, '../../..');
const REAL_PROC =
  '/Users/hrijul.bhatnagar/Files/Code/ff-procedures/ops/procedures/OPS/EPS/FCP/FF_AXX_FCP_EPS_181_Set_solar_panel_string_3_shunt_threshold.py';

describe('ruff wasm', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ws: any;
  beforeAll(async () => {
    const dir = join(ROOT, 'node_modules/@astral-sh/ruff-wasm-web');
    const mod = await import(/* @vite-ignore */ join(dir, 'ruff_wasm.js'));
    mod.initSync({ module: readFileSync(join(dir, 'ruff_wasm_bg.wasm')) });
    ws = new mod.Workspace(RUFF_SETTINGS, mod.PositionEncoding.Utf16);
  });

  it('reports lint rules with 1-based positions and ignores configured noise', () => {
    const code = 'import os\nfrom typing import List\n\n\ndef f(a: List[int]):\n    x = 1\n    print(nope)  # ' + 'x'.repeat(130) + '\n';
    const codes = ws.check(code).map((d: { code: string }) => d.code).sort();
    expect(codes).toContain('F401');
    expect(codes).toContain('F841');
    expect(codes).toContain('F821');
    expect(codes).not.toContain('E501');
    expect(codes).not.toContain('UP006');
    expect(codes).not.toContain('UP035');
    const d = ws.check(code).find((x: { code: string }) => x.code === 'F821');
    expect(d.start_location).toEqual({ row: 7, column: 11 });
  });

  it('flags syntax errors as invalid-syntax and formats valid code', () => {
    expect(ws.check('def f(:\n')[0].code).toBe('invalid-syntax');
    expect(ws.format("x = {  'a':1 }\n")).toBe('x = {"a": 1}\n');
    expect(() => ws.format('def f(:\n')).toThrow();
  });

  it('real procedure has no ruff errors beyond style/unused-import warnings', () => {
    if (!existsSync(REAL_PROC)) return;
    const codes = ws.check(readFileSync(REAL_PROC, 'utf8')).map((d: { code: string }) => d.code);
    expect(codes.filter((c: string) => c === 'invalid-syntax' || c.startsWith('E9') || c === 'F821')).toEqual([]);
  });
});

const PYODIDE_DIR = join(ROOT, 'public/vendor/pyodide');
const haveVendor = existsSync(join(PYODIDE_DIR, 'jedi-0.19.2-py2.py3-none-any.whl'));

describe.skipIf(!haveVendor)('pyodide: mos_lint + jedi', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let py: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let lint: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let intel: any;
  const PY_ROOT = '/home/pyodide/mos_py';

  beforeAll(async () => {
    const { loadPyodide } = await import('pyodide');
    py = await loadPyodide({ indexURL: PYODIDE_DIR + '/', stdout: () => {}, stderr: () => {} });
    const manifest = JSON.parse(readFileSync(join(ROOT, 'public/py/manifest.json'), 'utf8')) as { files: string[] };
    for (const f of manifest.files) {
      if (!(f.startsWith('mos_lint/') || f.startsWith('framework/'))) continue;
      const full = `${PY_ROOT}/${f}`;
      py.FS.mkdirTree(full.slice(0, full.lastIndexOf('/')));
      py.FS.writeFile(full, readFileSync(join(ROOT, 'public/py', f), 'utf8'));
    }
    py.runPython(`import sys; sys.path.insert(0, '${PY_ROOT}')`);
    lint = py.pyimport('mos_lint');
    await py.loadPackage(['parso', 'jedi']);
    intel = py.pyimport('mos_lint.intel');
  }, 120_000);

  it('mos_check runs in Pyodide and agrees with the real procedure fixture', () => {
    if (!existsSync(REAL_PROC)) return;
    const res = JSON.parse(lint.mos_check_json(readFileSync(REAL_PROC, 'utf8'), 'FF'));
    expect(res.diagnostics.filter((d: { severity: string }) => d.severity === 'error')).toEqual([]);
    expect(res.entry.entrypoint).toBe('Set_solar_panel_string_3_shunt_threshold_Procedure');
  });

  const code = "import math\nimport time\n\n\ndef _h(a: int, b: str = 'x'):\n    '''Helper doc'''\n    return a\n\n\ndef run(x: float):\n    y = math.sq\n    _h(1, \n    time.sleep(2)\n";

  it('completes stdlib members', () => {
    const items = JSON.parse(intel.complete(code, 11, '    y = math.sq'.length));
    expect(items.map((i: { label: string }) => i.label)).toContain('sqrt');
    const doc = JSON.parse(intel.resolve(items.findIndex((i: { label: string }) => i.label === 'sqrt')));
    expect(doc.doc).toContain('square root');
  });

  it('hover, signature help and same-file definition', () => {
    const hover = JSON.parse(intel.hover(code, 13, 10));
    expect(hover.fullName).toBe('time.sleep');
    const sig = JSON.parse(intel.signature(code, 12, '    _h(1, '.length));
    expect(sig[0].params).toEqual(['a: int', "b: str='x'"]);
    expect(sig[0].activeParameter).toBe(1);
    const defs = JSON.parse(intel.definition(code, 12, 5));
    expect(defs).toEqual([{ startLine: 5, startColumn: 5, endLine: 5, endColumn: 7 }]);
  });
});
