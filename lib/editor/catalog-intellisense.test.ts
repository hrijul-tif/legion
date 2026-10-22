import { describe, expect, it, vi } from 'vitest';
import type * as Monaco from 'monaco-editor';
import { fixtureCatalog as catalog } from '../catalog/fixture';
import { registerCatalogIntellisense, validateCatalogUsage, DIAGNOSTIC_OWNER } from './catalog-intellisense';
import {
  analyze,
  detectAliases,
  detectImportedNames,
  getCompletions,
  getHover,
  getSignature,
  validateSource,
} from './catalog-analysis';

const HEADER = `import framework.ff.commands as comm
import framework.ff.parameters as param
`;

/** Source with a `|` cursor marker. */
function cursor(src: string) {
  const offset = src.indexOf('|');
  return { source: src.replace('|', ''), offset };
}
function complete(src: string) {
  const { source, offset } = cursor(src);
  return getCompletions(analyze(source, catalog), offset);
}
function labels(src: string) {
  return (complete(src) ?? []).map((i) => i.label);
}

describe('detectAliases', () => {
  it('handles import ... as, from ... import and fully-qualified usage', () => {
    const a = detectAliases(`
import framework.ff.commands as comm, framework.ff.parameters as p
from framework.jtyu import commands as jc
from framework.ff import (
    commands as c2,
    parameters,
)
# import framework.ff.commands as commented_but_regex_sees_nothing
`);
    expect(a.get('comm')).toEqual({ kind: 'commands', mission: 'FF' });
    expect(a.get('p')).toEqual({ kind: 'parameters', mission: 'FF' });
    expect(a.get('jc')).toEqual({ kind: 'commands', mission: 'JTYU' });
    expect(a.get('c2')).toEqual({ kind: 'commands', mission: 'FF' });
    expect(a.get('parameters')).toEqual({ kind: 'parameters', mission: 'FF' });
    expect(a.get('framework.ff.commands')).toEqual({ kind: 'commands', mission: 'FF' });
    expect(a.has('commented_but_regex_sees_nothing')).toBe(false);
  });

  it('only keeps aliases of the catalog mission in the analysis', () => {
    const an = analyze(`import framework.jtyu.commands as jc\nimport framework.ff.commands as comm\n`, catalog);
    expect(an.aliases.has('jc')).toBe(false);
    expect(an.aliases.has('comm')).toBe(true);
  });

  it('detects direct class imports', () => {
    const m = detectImportedNames('from framework.ff.commands import EPSSwtAocs3v3BkMn as Swt, PusAckFlagsEnum\n');
    expect(m.get('Swt')).toEqual({ kind: 'commands', mission: 'FF', name: 'EPSSwtAocs3v3BkMn' });
    expect(m.get('PusAckFlagsEnum')?.name).toBe('PusAckFlagsEnum');
  });
});

describe('validateSource', () => {
  it('accepts a correct procedure', () => {
    const src = `${HEADER}
def run():
    cmd = comm.EPSSwtAocs3v3BkMn(
        On_Off_State=comm.NullConfigOnoffEnum.ON,
        Pus_Acknowledgement_Flags='Acceptance | Completion',
    )
    cmd.execute_await_completion(timeout=5)
    param.AOCSAocsMode().read_latest_parameter_value()
    comm.PayloadCaptureImage(Exposure_Ms=10, Pus_Acknowledgement_Flags=comm.PusAckFlagsEnum.NONE).execute()
`;
    expect(validateSource(src, catalog)).toEqual([]);
  });

  it('reports unknown command with suggestions and a precise range', () => {
    const src = `${HEADER}x = comm.EPSSwtAocs3v3BkMnn(On_Off_State='On', Pus_Acknowledgement_Flags='None')\n`;
    const d = validateSource(src, catalog);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({
      severity: 'error',
      code: 'unknown-command',
      startLineNumber: 3,
      startColumn: 10,
      endLineNumber: 3,
      endColumn: 28,
      fixes: ['EPSSwtAocs3v3BkMn'],
    });
    expect(d[0].message).toContain("'EPSSwtAocs3v3BkMnn' is not a command in the FF MDB");
    expect(d[0].message).toContain("'EPSSwtAocs3v3BkMn'");
  });

  it('reports unknown parameter', () => {
    const d = validateSource(`${HEADER}v = param.EPSBatteryVoltge().read_latest_parameter_value()\n`, catalog);
    expect(d.map((x) => x.code)).toEqual(['unknown-parameter']);
    expect(d[0].fixes?.[0]).toBe('EPSBatteryVoltage');
  });

  it('reports unknown kwargs and pre-assigned kwargs', () => {
    const src = `${HEADER}comm.PayloadCaptureImage(Exposure_Ms=1, Gainn=2, Base_ID='x', Pus_Acknowledgement_Flags='None')\n`;
    const d = validateSource(src, catalog);
    expect(d.map((x) => [x.code, x.severity])).toEqual([
      ['unknown-argument', 'error'],
      ['preassigned-argument', 'warning'],
    ]);
    expect(d[0].fixes).toEqual(['Gain']);
  });

  it('warns about missing required kwargs (only for closed calls without **)', () => {
    const missing = validateSource(`${HEADER}comm.PayloadCaptureImage(Gain=2)\n`, catalog);
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({ severity: 'warning', code: 'missing-argument' });
    expect(missing[0].message).toContain('Exposure_Ms, Pus_Acknowledgement_Flags');
    expect(validateSource(`${HEADER}comm.PayloadCaptureImage(**kw)\n`, catalog)).toEqual([]);
    expect(validateSource(`${HEADER}comm.PayloadCaptureImage(Gain=2,\n`, catalog)).toEqual([]);
  });

  it('accepts wire names and field_ args', () => {
    expect(validateSource(`${HEADER}comm.AOCSSetImuPLpfCutFreq(axis='x', field_3dBfreq=3)\n`, catalog)).toEqual([]);
    expect(validateSource(`${HEADER}comm.AOCSSetImuPLpfCutFreq(axis='x', _3dBfreq=3)\n`, catalog)).toEqual([]);
  });

  it('reports unknown enum members and mismatched enums', () => {
    const d = validateSource(
      `${HEADER}comm.EPSSwtAocs3v3BkMn(On_Off_State=comm.NullConfigOnoffEnum.Onn, Pus_Acknowledgement_Flags=comm.NullConfigOnoffEnum.ON)\n`,
      catalog,
    );
    expect(d.map((x) => x.code).sort()).toEqual(['enum-mismatch', 'unknown-enum-member']);
    const member = d.find((x) => x.code === 'unknown-enum-member')!;
    expect(member.fixes).toContain('ON');
  });

  it('suggests the member for enum values written as attribute names', () => {
    const d = validateSource(`${HEADER}x = comm.PusAckFlagsEnum.Acceptance\n`, catalog);
    expect(d[0].fixes?.[0]).toBe('ACCEPTANCE');
  });

  it('warns on raw strings that are not enum values', () => {
    const src = `${HEADER}comm.EPSSwtAocs3v3BkMn(On_Off_State='Onn', Pus_Acknowledgement_Flags='Acceptance | Completion')\n`;
    const d = validateSource(src, catalog);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ severity: 'warning', code: 'invalid-enum-value', startLineNumber: 3, fixes: ["'On'", "'Off'"] });
  });

  it('works with from-imports, fully-qualified names and ignores other missions', () => {
    const fq = validateSource(`import framework.ff.commands\nframework.ff.commands.Nope()\n`, catalog);
    expect(fq.map((x) => x.code)).toEqual(['unknown-command']);
    const q = validateSource(`from framework.ff import commands as c\nc.Nope()\n`, catalog);
    expect(q.map((x) => x.code)).toEqual(['unknown-command']);
    expect(validateSource(`import framework.jtyu.commands as c\nc.Nope()\n`, catalog)).toEqual([]);
  });

  it('does not flag module passthrough names or enum attributes', () => {
    const src = `${HEADER}x = comm.SuperCommand\ny = comm.PusAckFlagsEnum.NONE.value\nz = comm.PusAckFlagsEnum.__members__\n`;
    expect(validateSource(src, catalog)).toEqual([]);
  });

  it('handles CRLF line endings for ranges', () => {
    const src = `import framework.ff.commands as comm\r\ncomm.Nope()\r\n`;
    const d = validateSource(src, catalog);
    expect(d[0]).toMatchObject({ startLineNumber: 2, startColumn: 6, endColumn: 10 });
  });
});

describe('completions', () => {
  it('lists command classes and enums after the command alias', () => {
    const items = complete(`${HEADER}comm.|`)!;
    const names = items.map((i) => i.label);
    expect(names).toEqual(expect.arrayContaining(['EPSSwtAocs3v3BkMn', 'PayloadCaptureImage', 'PusAckFlagsEnum']));
    expect(names).not.toContain('AOCSAocsMode');
    const cls = items.find((i) => i.label === 'EPSSwtAocs3v3BkMn')!;
    expect(cls.kind).toBe('class');
    expect(cls.detail).toBe('/FF/EPS/Swt_aocs3v3BkMn');
    expect(cls.lazyDocumentation!()).toContain('On_Off_State');
    expect(items.find((i) => i.label === 'PusAckFlagsEnum')!.kind).toBe('enum');
  });

  it('filters by typed prefix and sets replace ranges', () => {
    const src = `${HEADER}comm.Payl|oad`;
    const items = complete(src)!;
    expect(items.map((i) => i.label)).toEqual(['PayloadCaptureImage']);
    const { source, offset } = cursor(src);
    expect(source.slice(items[0].start, items[0].insertEnd)).toBe('Payl');
    expect(source.slice(items[0].start, items[0].replaceEnd)).toBe('Payload');
    expect(offset).toBe(items[0].insertEnd);
  });

  it('lists parameter classes and parameter enums after the param alias', () => {
    const names = labels(`${HEADER}param.|`);
    expect(names).toEqual(expect.arrayContaining(['AOCSAocsMode', 'EPSBatteryVoltage', 'AocsModeEnum']));
    expect(names).not.toContain('EPSSwtAocs3v3BkMn');
  });

  it('lists enum members after <alias>.<Enum>.', () => {
    const items = complete(`${HEADER}comm.PusAckFlagsEnum.|`)!;
    expect(items.map((i) => i.label)).toEqual(['ACCEPTANCE___COMPLETION', 'ACCEPTANCE', 'COMPLETION', 'NONE']);
    expect(items[0].detail).toBe("'Acceptance | Completion'");
  });

  it('works with fully-qualified module paths', () => {
    expect(labels(`import framework.ff.commands\nframework.ff.commands.|`)).toContain('EPSSwtAocs3v3BkMn');
  });

  it('suggests unused kwargs inside a command call', () => {
    const items = complete(`${HEADER}comm.EPSSwtAocs3v3BkMn(On_Off_State=comm.NullConfigOnoffEnum.ON, |)`)!;
    expect(items.map((i) => i.label)).toEqual(['Pus_Acknowledgement_Flags', 'Command_Timetag']);
    expect(items[0].insertText).toBe('Pus_Acknowledgement_Flags=$0');
    expect(items[0].snippet).toBe(true);
    expect(items[0].retrigger).toBe(true);
    expect(items[0].sortText < items[1].sortText).toBe(true);
    expect(labels(`${HEADER}comm.EPSSwtAocs3v3BkMn(Pus|)`)).toEqual(['Pus_Acknowledgement_Flags']);
  });

  it('suggests kwargs on a continuation line', () => {
    const items = complete(`${HEADER}comm.PayloadCaptureImage(\n    Exposure_Ms=1,\n    |\n)`)!;
    // required args sort before optional ones
    expect([...items].sort((a, b) => (a.sortText < b.sortText ? -1 : 1)).map((i) => i.label)).toEqual(['Pus_Acknowledgement_Flags', 'Gain']);
  });

  it('suggests enum members and raw strings after Name=', () => {
    const items = complete(`${HEADER}comm.EPSSwtAocs3v3BkMn(Pus_Acknowledgement_Flags=|)`)!;
    const l = items.map((i) => i.label);
    expect(l).toContain('comm.PusAckFlagsEnum.ACCEPTANCE___COMPLETION');
    expect(l).toContain("'Acceptance | Completion'");
    expect(items.find((i) => i.label === "'None'")!.insertText).toBe("'None'");
  });

  it('suggests only raw values inside a string literal', () => {
    const src = `${HEADER}comm.EPSSwtAocs3v3BkMn(On_Off_State='O|')`;
    const items = complete(src)!;
    expect(items.map((i) => i.label)).toEqual(['Off', 'On']);
    const { source } = cursor(src);
    expect(source.slice(items[0].start, items[0].replaceEnd)).toBe('O');
  });

  it('suggests SuperParameter / SuperCommand methods on instances', () => {
    const p = complete(`${HEADER}param.AOCSAocsMode().|`)!;
    expect(p.map((i) => i.label)).toEqual([
      'read_latest_parameter_value',
      'read_latest_parameter_value_raw',
      'get_fresh_parameter_value',
      'read_fresh_parameter_value',
      'read_parameter_until_range',
      'read_parameter_until',
      'read_parameter_until_no_prompt',
    ]);
    const c = complete(`${HEADER}comm.PayloadCaptureImage(Exposure_Ms=1).exec|`)!;
    expect(c.map((i) => i.label)).toEqual(expect.arrayContaining(['execute', 'execute_await_completion', 'execute_check_tm']));
    expect(c.every((i) => i.label.includes('exec'))).toBe(true);
  });

  it('suggests methods on variables assigned from catalog calls', () => {
    const src = `${HEADER}cmd = comm.PayloadCaptureImage(Exposure_Ms=1)\ncmd.|`;
    expect(labels(src)).toContain('execute_check_tm_until');
    expect(labels(`${HEADER}p = param.EPSBatteryVoltage()\np.|`)).toContain('read_fresh_parameter_value');
  });

  it('suggests method kwargs', () => {
    const items = complete(`${HEADER}comm.PayloadCaptureImage(Exposure_Ms=1).execute_await_completion(|)`)!;
    expect(items.map((i) => i.label)).toEqual(['timeout', 'retry_count', 'comment']);
  });

  it('returns null for unrelated positions', () => {
    expect(complete(`${HEADER}x = foo.|`)).toBeNull();
    expect(complete(`${HEADER}x = 12|`)).toBeNull();
    expect(complete(`${HEADER}print(|)`)).toBeNull();
  });
});

describe('hover', () => {
  function hover(src: string) {
    const { source, offset } = cursor(src);
    return getHover(analyze(source, catalog), offset);
  }
  it('shows a card for a command class', () => {
    const h = hover(`${HEADER}comm.EPSSwt|Aocs3v3BkMn()`)!;
    expect(h.markdown).toContain('/FF/EPS/Swt_aocs3v3BkMn');
    expect(h.markdown).toContain('On_Off_State');
    expect(h.markdown).toContain('NullConfigOnoffEnum');
    expect(h.markdown).toContain('Logical_Device_ID');
    expect(h.markdown).toContain('EPS');
  });
  it('shows parameter, enum and member cards', () => {
    expect(hover(`${HEADER}param.AOCSAoc|sMode()`)!.markdown).toContain('enumeration');
    expect(hover(`${HEADER}comm.PusAck|FlagsEnum.NONE`)!.markdown).toContain('ACCEPTANCE___COMPLETION');
    expect(hover(`${HEADER}comm.PusAckFlagsEnum.AC|CEPTANCE`)!.markdown).toContain("'Acceptance'");
  });
  it('shows method and kwarg docs', () => {
    expect(hover(`${HEADER}comm.PayloadCaptureImage().execute_check|_tm_until()`)!.markdown).toContain('tm_parameter');
    expect(hover(`${HEADER}comm.PayloadCaptureImage(Exposure|_Ms=1)`)!.markdown).toContain('Exposure time in milliseconds');
  });
  it('shows nothing for unknown names', () => {
    expect(hover(`${HEADER}comm.No|pe()`)).toBeNull();
    expect(hover(`${HEADER}fo|o = 1`)).toBeNull();
  });
});

describe('signature help', () => {
  function sig(src: string) {
    const { source, offset } = cursor(src);
    return getSignature(analyze(source, catalog), offset);
  }
  it('lists command kwargs and tracks the active one', () => {
    const s = sig(`${HEADER}comm.PayloadCaptureImage(Exposure_Ms=1, |)`)!;
    expect(s.label).toBe('PayloadCaptureImage(Exposure_Ms: int, Gain: float = 1, Pus_Acknowledgement_Flags: PusAckFlagsEnum)');
    expect(s.activeParameter).toBe(1);
    const [start, end] = s.parameters[2].label;
    expect(s.label.slice(start, end)).toBe('Pus_Acknowledgement_Flags: PusAckFlagsEnum');
    expect(sig(`${HEADER}comm.PayloadCaptureImage(Pus_Acknowledgement_Flags=|)`)!.activeParameter).toBe(2);
  });
  it('covers methods, including from inside a nested list', () => {
    const s = sig(`${HEADER}comm.PayloadCaptureImage().execute_check_tm_until(param.EPSBatteryVoltage(), |)`)!;
    expect(s.label).toContain('execute_check_tm_until(tm_parameter: SuperParameter, expected_tm_value: Any, comparison_operator = operator.eq');
    expect(s.activeParameter).toBe(1);
    const s2 = sig(`${HEADER}comm.PayloadCaptureImage().execute_check_tms_until_special([param.A(), |])`)!;
    expect(s2.label.startsWith('execute_check_tms_until_special(')).toBe(true);
    expect(sig(`${HEADER}print(|)`)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// Monaco glue, against a minimal fake of the namespace

function fakeModel(initial: string) {
  let text = initial;
  let version = 1;
  const listeners: (() => void)[] = [];
  const lineStarts = () => {
    const ls = [0];
    for (let i = 0; i < text.length; i++) if (text[i] === '\n') ls.push(i + 1);
    return ls;
  };
  return {
    uri: { toString: () => 'file:///fake.py' },
    getValue: () => text,
    getVersionId: () => version,
    isDisposed: () => false,
    getLanguageId: () => 'python',
    getOffsetAt: (p: { lineNumber: number; column: number }) => lineStarts()[p.lineNumber - 1] + p.column - 1,
    getPositionAt: (o: number) => {
      const ls = lineStarts();
      let line = ls.length - 1;
      while (ls[line] > o) line--;
      return { lineNumber: line + 1, column: o - ls[line] + 1 };
    },
    onDidChangeContent: (cb: () => void) => (listeners.push(cb), { dispose() {} }),
    onDidChangeLanguage: () => ({ dispose() {} }),
    edit(next: string) {
      text = next;
      version++;
      listeners.forEach((l) => l());
    },
  };
}

function fakeMonaco(models: ReturnType<typeof fakeModel>[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const providers: Record<string, any> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markers: Record<string, any[]> = {};
  const reg = (name: string) => (_lang: string, provider: unknown) => {
    providers[name] = provider;
    return { dispose() {} };
  };
  const monaco = {
    MarkerSeverity: { Error: 8, Warning: 4, Info: 2, Hint: 1 },
    languages: {
      CompletionItemKind: { Class: 5, Enum: 15, EnumMember: 16, Property: 9, Value: 12, Method: 1, Module: 8 },
      CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
      registerCompletionItemProvider: reg('completion'),
      registerHoverProvider: reg('hover'),
      registerSignatureHelpProvider: reg('signature'),
      registerCodeActionProvider: reg('codeAction'),
    },
    editor: {
      getModels: () => models,
      onDidCreateModel: () => ({ dispose() {} }),
      onWillDisposeModel: () => ({ dispose() {} }),
      setModelMarkers: (_m: unknown, owner: string, ms: unknown[]) => {
        markers[owner] = ms;
      },
    },
  } as unknown as typeof Monaco;
  return { monaco, providers, markers };
}

describe('registerCatalogIntellisense (fake monaco)', () => {
  it('wires providers and debounced diagnostics', () => {
    vi.useFakeTimers();
    try {
      const model = fakeModel(`${HEADER}comm.Nope()\n`);
      const { monaco, providers, markers } = fakeMonaco([model]);
      const handle = registerCatalogIntellisense(monaco, { getCatalog: () => catalog });
      vi.advanceTimersByTime(1);
      expect(markers[DIAGNOSTIC_OWNER]).toHaveLength(1);
      expect(markers[DIAGNOSTIC_OWNER][0]).toMatchObject({ severity: 8, source: DIAGNOSTIC_OWNER, code: 'unknown-command', startLineNumber: 3, startColumn: 6 });

      model.edit(`${HEADER}comm.EPSSwtAocs3v3BkMn(On_Off_State='On', Pus_Acknowledgement_Flags='None')\n`);
      expect(markers[DIAGNOSTIC_OWNER]).toHaveLength(1); // debounced: not yet re-run
      vi.advanceTimersByTime(250);
      expect(markers[DIAGNOSTIC_OWNER]).toEqual([]);

      // completion provider
      const src = `${HEADER}comm.Payl`;
      const m2 = fakeModel(src);
      const pos = m2.getPositionAt(src.length);
      const res = providers.completion.provideCompletionItems(m2, pos);
      expect(res.suggestions.map((s: { label: string }) => s.label)).toEqual(['PayloadCaptureImage']);
      expect(res.suggestions[0].range.replace).toMatchObject({ startLineNumber: 3, startColumn: 6, endColumn: 10 });
      const resolved = providers.completion.resolveCompletionItem(res.suggestions[0]);
      expect(resolved.documentation.value).toContain('Exposure_Ms');

      // hover + signature
      const m3 = fakeModel(`${HEADER}comm.PayloadCaptureImage(Gain=1, )`);
      const hover = providers.hover.provideHover(m3, { lineNumber: 3, column: 10 });
      expect(hover.contents[0].value).toContain('/FF/Payload/Capture_Image');
      const sig = providers.signature.provideSignatureHelp(m3, { lineNumber: 3, column: 34 });
      expect(sig.value.signatures[0].label).toContain('PayloadCaptureImage(');
      expect(sig.value.activeParameter).toBe(1);

      // quick fix
      const m4 = fakeModel(`${HEADER}x = comm.PayloadCaptureImag()\n`);
      const ms = validateCatalogUsage(monaco, m4 as unknown as Monaco.editor.ITextModel, catalog);
      const actions = providers.codeAction.provideCodeActions(m4, {}, { markers: ms });
      expect(actions.actions[0].title).toBe('Replace with PayloadCaptureImage');
      expect(actions.actions[0].edit.edits[0].textEdit.text).toBe('PayloadCaptureImage');

      handle.dispose();
      expect(markers[DIAGNOSTIC_OWNER]).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
