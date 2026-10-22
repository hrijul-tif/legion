// Public runtime methods of SuperParameter / SuperCommand (mos-framework: framework/mdb/super_class.py).
// Names, signatures and docs mirror the real framework; keep in sync when it changes.

export interface MethodParam {
  name: string;
  type?: string;
  /** Python source of the default, e.g. `10`, `None`, `operator.eq` */
  default?: string;
  doc: string;
}

export interface MethodSpec {
  name: string;
  params: MethodParam[];
  returns?: string;
  summary: string;
  returnDoc?: string;
}


const FRESH_SUMMARY = 'Retrieve the fresh value of the specified parameter.';
const UNTIL_SUMMARY =
  "Read a parameter's value until it's equal to the expected value or until the given timeout elapses.";
const EXEC_CHECK_SUMMARY =
  'Executes the command and waits for successful completion. Then waits for the given interval and checks ONCE if the value of the given parameter meets the given condition.';

const tmParam: MethodParam = {
  name: 'tm_parameter',
  type: 'SuperParameter',
  doc: 'Object of a parameter class generated from the MDb.',
};
const expectedTm: MethodParam = {
  name: 'expected_tm_value',
  type: 'Any',
  doc: 'Expected value of the telemetry that needs to be checked.',
};
const cmpOp: MethodParam = {
  name: 'comparison_operator',
  default: 'operator.eq',
  doc: 'Type of comparison to perform between the parameter and its expected value.',
};
const execTc: MethodParam = {
  name: 'exec_tc',
  type: 'bool',
  default: 'True',
  doc: 'Used internally to handle parameter verification re-check. Do not set it to False.',
};
const cmdTimeout: MethodParam = {
  name: 'timeout',
  type: 'float',
  default: '10',
  doc: "Timeout for command's execution completion. Default - 10 seconds.",
};

export const PARAMETER_METHODS: MethodSpec[] = [
  {
    name: 'read_latest_parameter_value',
    params: [],
    summary: 'Retrieve the current value of the specified parameter.',
    returnDoc: 'Returns the engineering value of the given parameter.',
  },
  {
    name: 'read_latest_parameter_value_raw',
    params: [],
    summary: 'Retrieve the current value of the specified parameter.',
    returnDoc: 'Returns the raw value of the given parameter.',
  },
  {
    name: 'get_fresh_parameter_value',
    params: [
      { name: 'wait_seconds', type: 'float', default: '0', doc: 'Number of seconds to wait before fetching the value of the parameter. Optional. Default - 0.' },
      { name: 'timeout', type: 'float', default: '10', doc: 'The amount of seconds to wait for a fresh value. Default - 10.' },
      {
        name: 'comm_gen_time',
        type: 'datetime',
        default: 'None',
        doc: "If this is None, it will wait for a fresh value. If this is not None, the parameter will be read from cache and its gentime will be compared with this value to derive if it's latest.",
      },
    ],
    summary: FRESH_SUMMARY,
    returnDoc: 'Engineering value of the given parameter. `None` if there is no value received in the given timeout.',
  },
  {
    name: 'read_fresh_parameter_value',
    params: [
      { name: 'wait_seconds', type: 'float', default: '0', doc: 'Number of seconds to wait before fetching the value of the parameter. Optional. Default - 0.' },
      { name: 'timeout', type: 'float', default: '10', doc: 'The amount of seconds to wait for a fresh value. Default - 10.' },
      { name: 'initial_read_time', type: 'datetime', default: 'None', doc: 'Only values generated after this time count as fresh.' },
      {
        name: 'fail_fast',
        type: 'bool',
        default: 'False',
        doc: 'If True, the procedure will stop if the parameter is not received. Use `False` if you need a prompt for user to choose how to proceed. Default - False.',
      },
    ],
    summary: FRESH_SUMMARY,
    returnDoc: 'Engineering value of the given parameter. `None` if there is no value received in the given timeout.',
  },
  {
    name: 'read_parameter_until_range',
    params: [
      { name: 'expected_value', type: 'Any', doc: 'Expected value of the given parameter.' },
      { name: 'range_start', type: 'float', doc: 'Number of range comparison start.' },
      { name: 'range_end', type: 'float', doc: 'Number of range comparison end.' },
      { name: 'timeout', type: 'float', default: '10', doc: 'The amount of seconds to wait for the given parameter to be equal to the expected value.' },
    ],
    returns: 'Union[bool, Dict, Any]',
    summary: UNTIL_SUMMARY,
    returnDoc:
      'Returns `True` if the parameter is equal to the expected value, `False` if the parameter does not meet expected condition within the given timeout. Also returns the parameter name and the current value.',
  },
  {
    name: 'read_parameter_until',
    params: [
      { name: 'expected_value', type: 'Any', doc: 'Expected value of the given parameter.' },
      { name: 'comparison_operator', type: 'operator', default: 'operator.eq', doc: "The operator for comparison between the parameter's value, and its expected value." },
      { name: 'timeout', type: 'float', default: '10', doc: 'The amount of seconds to wait for the given parameter to be equal to the expected value.' },
    ],
    returns: 'Union[bool, Dict, Any]',
    summary: UNTIL_SUMMARY,
    returnDoc:
      'Returns `True` if the parameter is equal to the expected value, `False` if the parameter does not meet expected condition within the given timeout. Also returns the parameter name and the current value.',
  },
  {
    name: 'read_parameter_until_no_prompt',
    params: [
      { name: 'expected_value', type: 'Union[List, Any]', default: 'None', doc: 'Expected value of the given parameter.' },
      { name: 'comparison_operator', type: 'operator', default: 'operator.eq', doc: "The operator for comparison between the parameter's value, and its expected value." },
      { name: 'timeout', type: 'float', default: '10', doc: 'The amount of seconds to wait for the given parameter to be equal to the expected value.' },
      { name: 'until', type: 'float', default: '10', doc: 'The amount of seconds to keep checking for the given parameter to be equal to the expected value.' },
      {
        name: 'fail_fast',
        type: 'bool',
        default: 'True',
        doc: 'If True, the procedure will stop if the parameter is not received (or) the parameter comparison fails. Use `False` if you need a prompt for user to choose how to proceed.',
      },
      { name: 'check_tm', type: 'bool', default: 'True', doc: 'Whether to check the telemetry value.' },
    ],
    returns: 'Union[bool, Dict, Any]',
    summary: UNTIL_SUMMARY,
    returnDoc:
      'Returns `True` if the parameter is equal to the expected value, `False` if the parameter does not meet expected condition within the given timeout. Also returns the parameter name and the current value.',
  },
];

export const COMMAND_METHODS: MethodSpec[] = [
  {
    name: 'execute',
    params: [{ name: 'comment', type: 'str', default: 'None', doc: 'Optional comment attached to the command.' }],
    returns: 'str',
    summary: 'Executes the command with the given arguments. Essentially, just sends the prepared command to MCS.',
    returnDoc: 'Returns `True` if the command was sent successfully to MCS, `False` otherwise.',
  },
  {
    name: 'execute_await_completion_no_prompt',
    params: [
      { name: 'timeout', type: 'float', default: 'None', doc: 'Timeout for execution completion. Default - None.' },
      { name: 'retry_count', type: 'int', default: '0', doc: 'Number of times to retry sending the command and waiting for completion. Default - 0.' },
      { name: 'comment', type: 'str', default: 'None', doc: 'Optional comment attached to the command.' },
      { name: 'fail_fast', type: 'bool', default: 'True', doc: 'If true, raises an exception on command ack failure, else returns None(s).' },
    ],
    summary: 'Issue the given command.',
    returnDoc: 'Returns the acknowledgement status from MCS.',
  },
  {
    name: 'execute_await_completion',
    params: [
      { name: 'timeout', type: 'float', default: 'None', doc: 'Timeout for execution completion. Default - None.' },
      { name: 'retry_count', type: 'int', default: '0', doc: 'Number of times to retry sending the command and waiting for completion. Default - 0.' },
      { name: 'comment', type: 'str', default: 'None', doc: 'Optional comment attached to the command.' },
    ],
    summary: 'Issue the given command.',
    returnDoc: 'Returns the acknowledgement status from MCS.',
  },
  {
    name: 'execute_check_tm_until_no_prompt',
    params: [
      tmParam,
      expectedTm,
      cmpOp,
      { name: 'cmd_retry_count', type: 'int', default: '0', doc: 'Number of times to retry sending the command and waiting for completion. Default - 0.' },
      { name: 'param_retry_until', type: 'int', default: '0', doc: 'Amount of seconds to keep checking for the given parameter to be equal to the expected value.' },
      cmdTimeout,
      execTc,
      { name: 'fail_fast', type: 'bool', default: 'True', doc: 'If true, raises an exception on failure instead of prompting.' },
    ],
    summary: EXEC_CHECK_SUMMARY,
  },
  {
    name: 'execute_check_tm_until',
    params: [tmParam, expectedTm, cmpOp, cmdTimeout, execTc],
    summary: EXEC_CHECK_SUMMARY,
  },
  {
    name: 'execute_check_tm_until_special',
    params: [
      tmParam,
      { ...expectedTm, default: 'None' },
      cmpOp,
      cmdTimeout,
      execTc,
      { name: 'check_tm', type: 'bool', default: 'True', doc: 'Whether to check the telemetry value.' },
      { name: 'retry_count', type: 'int', default: '0', doc: 'Number of times to retry.' },
      { name: 'fail_fast', type: 'bool', default: 'False', doc: 'If true, raises an exception on failure instead of prompting.' },
      { name: 'use_eng', type: 'bool', default: 'False', doc: 'Compare against the engineering value instead of the raw value.' },
    ],
    summary: EXEC_CHECK_SUMMARY,
  },
  {
    name: 'execute_check_tms_until_special',
    params: [
      { name: 'tm_parameters', type: 'List[SuperParameter]', doc: 'Objects of parameter classes generated from the MDb.' },
      { name: 'expected_tm_values', type: 'List[Any]', default: 'None', doc: 'Expected values of the telemetry that needs to be checked.' },
      cmpOp,
      cmdTimeout,
      execTc,
      { name: 'check_tm', type: 'bool', default: 'True', doc: 'Whether to check the telemetry values.' },
    ],
    summary: EXEC_CHECK_SUMMARY,
  },
  {
    name: 'execute_check_tm',
    params: [
      tmParam,
      expectedTm,
      { ...cmpOp, type: 'operator' },
      { name: 'wait_seconds', type: 'float', default: '0', doc: 'Number of seconds to wait after successful completion of the command to check the telemetry parameter. Default - 0 seconds.' },
      cmdTimeout,
      execTc,
    ],
    returns: 'object',
    summary: EXEC_CHECK_SUMMARY,
  },
];

export const PARAMETER_METHOD_MAP = new Map(PARAMETER_METHODS.map((m) => [m.name, m]));
export const COMMAND_METHOD_MAP = new Map(COMMAND_METHODS.map((m) => [m.name, m]));

export function methodSignature(m: MethodSpec): string {
  const ps = m.params.map(paramLabel).join(', ');
  return `${m.name}(${ps})${m.returns ? ` -> ${m.returns}` : ''}`;
}

export function paramLabel(p: MethodParam): string {
  return `${p.name}${p.type ? `: ${p.type}` : ''}${p.default !== undefined ? ` = ${p.default}` : ''}`;
}

export function methodMarkdown(m: MethodSpec, owner: 'command' | 'parameter'): string {
  const lines = [
    '```python',
    `${owner === 'command' ? 'SuperCommand' : 'SuperParameter'}.${methodSignature(m)}`,
    '```',
    m.summary,
  ];
  if (m.params.length) {
    lines.push('', ...m.params.map((p) => `- \`${p.name}\` — ${p.doc}`));
  }
  if (m.returnDoc) lines.push('', `**Returns** ${m.returnDoc}`);
  return lines.join('\n');
}
