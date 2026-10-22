"""Sandbox re-implementation of framework.mdb.super_class (no pydantic / yamcs / inquirer).

Public methods, parameters, defaults, return values (including the inconsistent 2-/3-tuples and the
"continue" sentinel), prompt messages / choice strings, retry recursion and exceptions mirror the real
module. Differences: YAMCS calls go to mos_sim, `inquirer.prompt` becomes a UI prompt, ANSI colours
are dropped, and command construction is validated by the small coercion layer below (pydantic-like).
"""
import datetime as _datetime
import difflib
import enum
import operator
import pprint
import textwrap
import time
from datetime import datetime, timezone
from typing import Any, Union, Dict, List

from framework.settings import settings
from framework.utils.custom_exceptions import SkipProcedureError, ChooseProcedureError, StopExecutionError
from framework.utils.log_helper import run_logger as logger
from framework.utils.log_helper import extra_logger as bus_logger
from framework.utils.log_helper import csv_logger as csv_logger
from mos_sim import bridge
from mos_sim import processor as _sim

client = None
realtime_processor = None
logging_processor = None
conn = None


def set_connections():
    global client, realtime_processor, logging_processor, conn
    client = _sim
    realtime_processor = _sim.get_processor()
    logging_processor = _sim.get_processor()
    conn = realtime_processor.create_command_connection()


set_connections()


class Format:
    # ANSI colours are dropped in the sandbox (the UI shows plain text)
    UNDERLINE = ''
    LIGHT_RED = ''
    BOLD = ''
    END = ''
    BLUE = ''
    RESET = ''
    CYAN = ''
    LIGHT_PURPLE = ''
    YELLOW = ''


def pretty_repr(obj):
    return pprint.pformat(obj, width=80, sort_dicts=False)


def _utcnow():
    return _sim.now_utc()


_prompt_seq = [0]


def _ask(message, choices):
    """Replacement for `inquirer.prompt([inquirer.List('decision', ...)])['decision']`."""
    w = _sim.world()
    _prompt_seq[0] += 1
    w.emit_telemetry(force=True)
    ev = {'type': 'prompt', 'id': 'p%d' % _prompt_seq[0], 'message': message, 'choices': list(choices)}
    ev['t'] = round(w.clock.now, 3)
    ev['wall'] = int(bridge.real_time() * 1000)
    idx = bridge.prompt(ev)
    answer = choices[idx]
    w.log('info', 'operator chose: %s' % answer)
    return answer


# ---------------------------------------------------------------------------------------------
# Validation / coercion (what pydantic did for the generated models)
# ---------------------------------------------------------------------------------------------

class ValidationError(ValueError):
    """Stand-in for pydantic.ValidationError (a ValueError subclass, like the real one)."""

    def __init__(self, cls_name, errors):
        self.cls_name = cls_name
        self.errors = errors
        n = len(errors)
        lines = ['%d validation error%s for %s' % (n, '' if n == 1 else 's', cls_name)]
        for field, msg, etype, value in errors:
            lines.append(field)
            lines.append('  %s [type=%s, input_value=%r, input_type=%s]' % (msg, etype, value, type(value).__name__))
        ValueError.__init__(self, '\n'.join(lines))


_MISSING = object()


def _parse_dt(v):
    if isinstance(v, datetime):
        return v
    from framework.utils.commanding import _parse
    return _parse(v)


def _coerce(spec, value):
    """Returns (ok, value | (message, type))."""
    t = spec.type
    if value is None:
        if spec.required:
            return False, ('Input should be a valid %s' % ('number' if t == 'float' else t), 'missing')
        return True, None
    if t == 'enum' and spec.enum_cls is not None:
        cls = spec.enum_cls
        if isinstance(value, enum.Enum):
            if type(value) is cls:
                return True, value
            value = value.value
        s = str(value)
        for m in cls:
            if m.value == value or str(m.value) == s:
                return True, m
        for m in cls:
            if m.name == s:
                return True, m
        low = s.strip().casefold()
        for m in cls:
            if str(m.value).casefold() == low or m.name.casefold() == low:
                return True, m
        labels = [repr(m.value) for m in cls]
        if len(labels) > 1:
            expected = ', '.join(labels[:-1]) + ' or ' + labels[-1]
        else:
            expected = ', '.join(labels)
        return False, ('Input should be %s' % expected, 'enum')
    if t == 'float':
        if isinstance(value, (int, float)):
            return True, float(value)
        if isinstance(value, str):
            try:
                return True, float(value.strip())
            except ValueError:
                pass
        return False, ('Input should be a valid number, unable to parse string as a number', 'float_parsing')
    if t == 'int':
        if isinstance(value, bool):
            return True, int(value)
        if isinstance(value, int):
            return True, value
        if isinstance(value, float):
            if value == int(value):
                return True, int(value)
            return False, ('Input should be a valid integer, got a number with a fractional part', 'int_from_float')
        if isinstance(value, str):
            try:
                return True, int(value.strip())
            except ValueError:
                try:
                    f = float(value.strip())
                    if f == int(f):
                        return True, int(f)
                except ValueError:
                    pass
        return False, ('Input should be a valid integer, unable to parse string as an integer', 'int_parsing')
    if t == 'bool':
        if isinstance(value, bool):
            return True, value
        if isinstance(value, int) and value in (0, 1):
            return True, bool(value)
        if isinstance(value, str):
            low = value.strip().lower()
            if low in ('true', 't', 'yes', 'y', 'on', '1'):
                return True, True
            if low in ('false', 'f', 'no', 'n', 'off', '0'):
                return True, False
        return False, ('Input should be a valid boolean, unable to interpret input', 'bool_parsing')
    if t == 'str':
        if isinstance(value, str):
            return True, value
        return False, ('Input should be a valid string', 'string_type')
    if t == 'datetime':
        try:
            dt = _parse_dt(value)
        except Exception:
            return False, ('Input should be a valid datetime', 'datetime_parsing')
        if dt.tzinfo is None:
            return False, ('Input should have timezone info', 'timezone_aware')
        return True, dt
    if t == 'list':
        if isinstance(value, (list, tuple)):
            return True, list(value)
        return False, ('Input should be a valid list', 'list_type')
    return True, value


class _Model(object):
    """Shared construction logic of SuperParameter / SuperCommand (the pydantic BaseModel part)."""
    _fields_ = []
    _fixed_ = {}

    def _populate(self, data):
        cls = type(self)
        by_key = {}
        for spec in cls._fields_:
            by_key[spec.name] = spec
            by_key.setdefault(spec.wire, spec)
        unknown = [k for k in data if k not in by_key]
        if unknown:
            valid = [s.name for s in cls._fields_]
            msg = '%s() got an unexpected keyword argument %r' % (cls.__name__, unknown[0])
            close = difflib.get_close_matches(unknown[0], valid, n=1, cutoff=0.5)
            if close:
                msg += ". Did you mean %r?" % close[0]
            msg += ' Valid arguments: %s' % (', '.join(valid) if valid else '(none)')
            raise TypeError(msg)
        errors = []
        values = {}
        for spec in cls._fields_:
            raw = _MISSING
            if spec.name in data:
                raw = data[spec.name]
            elif spec.wire in data:
                raw = data[spec.wire]
            if raw is _MISSING:
                if spec.required:
                    errors.append((spec.name, 'Field required', 'missing', {k: v for k, v in data.items()}))
                    continue
                values[spec.name] = spec.default if spec.has_default else None
                continue
            ok, res = _coerce(spec, raw)
            if not ok:
                errors.append((spec.name, res[0], res[1], raw))
            else:
                values[spec.name] = res
        if errors:
            raise ValidationError(cls.__name__, errors)
        for spec in cls._fields_:
            setattr(self, spec.name, values[spec.name])

    def model_dump(self):
        return {spec.name: getattr(self, spec.name) for spec in type(self)._fields_}

    dict = model_dump

    def __repr__(self):
        return '%s(%s)' % (type(self).__name__, ', '.join(
            '%s=%r' % (s.name, getattr(self, s.name, None)) for s in type(self)._fields_))


# Logs given parameters after every command is run
class SpecialParameterLogger(object):
    parameters: List["SuperParameter"] = []
    subscriptions: List[Any] = []

    def __init__(self, parameters: List["SuperParameter"], /, **data: Any):
        self.parameters = parameters
        self.subscriptions = []

    @staticmethod
    def log_data(data):
        for parameter in data.parameters:
            bus_logger.info(parameter)

    def start_parameter_logger(self):
        subscriptions = []
        for parameter in self.parameters:
            subscription = logging_processor.create_parameter_subscription(
                parameter.qualified_name, on_data=self.log_data
            )
            subscriptions.append(subscription)
        self.subscriptions = subscriptions

    def stop_parameter_logger(self):
        for subscription in self.subscriptions:
            subscription.cancel()


class SuperParameter(_Model):
    qualified_name: str = ""
    formatted_name: str = ""
    generation_time: datetime = None
    field_qualified_name_ = ""

    def __init__(self, /, **data: Any):
        self._populate(data)
        self.qualified_name = self.field_qualified_name_
        self.formatted_name = Format.BOLD + Format.UNDERLINE + Format.LIGHT_PURPLE + self.field_qualified_name_ + Format.END
        self.generation_time = None

    @staticmethod
    def get_truth(inp, op, cut):
        if isinstance(cut, list):
            for val in cut:
                if op(inp, val):
                    return True
            return False
        return op(inp, cut)

    def read_latest_parameter_value(self):
        """
        Retrieve the current value of the specified parameter.

        :return:
            Returns the engineering value of the given parameter.
        """
        parameter_name = self.field_qualified_name_

        csv_logger.debug("Reading latest value of parameter,`%s`", self.qualified_name)
        logger.debug("Reading latest value of parameter: `%s`", self.formatted_name)

        parameter_val = realtime_processor.get_parameter_value(parameter_name)

        csv_logger.debug("Value of parameter,%s", parameter_val)
        logger.debug("Value of parameter: `%s` is :%s", self.formatted_name, parameter_val)

        if parameter_val == None:
            csv_logger.warning("No value read for parameter: `%s`", self.qualified_name)
            logger.warning("No value read for parameter: `%s`", self.formatted_name)
            return None

        self.generation_time = parameter_val.generation_time
        return parameter_val.eng_value

    # temporary, need a better way to do this
    def read_latest_parameter_value_raw(self):
        """
        Retrieve the current value of the specified parameter.

        :return:
            Returns the raw value of the given parameter.
        """
        parameter_name = self.field_qualified_name_

        csv_logger.debug("Reading latest value of parameter,`%s`", self.qualified_name)
        logger.debug("Reading latest value of parameter: `%s`", self.formatted_name)

        parameter_val = realtime_processor.get_parameter_value(parameter_name)

        csv_logger.debug("Value of parameter,%s", parameter_val)
        logger.debug("Value of parameter: `%s` is :%s", self.formatted_name, parameter_val)

        if parameter_val == None:
            csv_logger.warning("No value read for parameter: `%s`", self.qualified_name)
            logger.warning("No value read for parameter: `%s`", self.formatted_name)
            return None

        self.generation_time = parameter_val.generation_time
        return parameter_val.raw_value

    def get_fresh_parameter_value(self, wait_seconds: float = 0, timeout: float = 10, comm_gen_time: datetime = None):
        """
        Retrieve the fresh value of the specified parameter.

        :param timeout:
            The amount of seconds to wait for a fresh value.
            Default - 10.
        :param wait_seconds:
            Number of seconds to wait before fetching the value of the parameter. Optional.
            Default - 0.
        :param comm_gen_time:
            If this is None, it will wait for a fresh value. If this is not None, the parameter will be read from cache and it's gentime will be compared with this value to derive if it's latest.
        :return:
            Engineering value of the given parameter.
            `None` if there is no value received in the given timeout.
        """
        if wait_seconds != 0:
            time.sleep(wait_seconds)

        parameter_name = self.field_qualified_name_

        csv_logger.debug("Reading fresh value of parameter,`%s`", self.qualified_name)
        logger.debug("Reading fresh value of parameter: `%s`", self.formatted_name)

        if comm_gen_time is None:
            parameter_val = realtime_processor.get_parameter_value(
                parameter_name, from_cache=False, timeout=timeout
            )
            if parameter_val is None:
                csv_logger.warning("No FRESH value read for parameter: `%s`", self.qualified_name)
                logger.warning("No FRESH value read for parameter: `%s`", self.formatted_name)
                return False, None
        else:
            parameter_val = realtime_processor.get_parameter_value(
                parameter_name, from_cache=True, timeout=timeout
            )
            if parameter_val.reception_time < comm_gen_time:
                csv_logger.warning("No FRESH value read for parameter: `%s`", self.qualified_name)
                logger.warning("No FRESH value read for parameter: `%s`", self.formatted_name)
                return False, None

        csv_logger.debug("Received fresh value,%s", parameter_val.eng_value)
        logger.debug("Received fresh value of parameter: `%s` is :%s", self.formatted_name, parameter_val.eng_value)

        self.generation_time = parameter_val.generation_time
        return True, parameter_val.eng_value

    def read_fresh_parameter_value(self, wait_seconds: float = 0, timeout: float = 10, initial_read_time: datetime = None, fail_fast: bool = False):
        """
        Retrieve the fresh value of the specified parameter.

        :param timeout:
            The amount of seconds to wait for a fresh value.
            Default - 10.
        :param wait_seconds:
            Number of seconds to wait before fetching the value of the parameter. Optional.
            Default - 0.
        :param fail_fast:
            If True, the procedure will stop if the parameter is not received. Use `False` if you need a prompt for user to choose how to proceed.
            Default - False.
        :return:
            Engineering value of the given parameter.
            `None` if there is no value received in the given timeout.
        """
        if wait_seconds != 0:
            time.sleep(wait_seconds)

        parameter_name = self.field_qualified_name_

        csv_logger.debug("Reading fresh value of parameter,`%s`", self.qualified_name)
        logger.debug("Reading fresh value of parameter: `%s`", self.formatted_name)

        # If an initial read time was provided, don't create another read time. This is to make sure the time of read start is preserved across multiple retries
        read_start_time = initial_read_time
        if initial_read_time == None:
            # (the real code strips tzinfo here; the sandbox keeps all timestamps timezone-aware)
            read_start_time = _utcnow()

        parameter_val = realtime_processor.get_parameter_value(
            parameter_name, from_cache=False, timeout=timeout
        )

        # if the parameter is not received and fail fast is false, prompt the user to choose how to proceed
        if parameter_val is None and not fail_fast:
            csv_logger.warning("No FRESH value read for parameter: `%s`", self.qualified_name)
            logger.warning("No FRESH value read for parameter: `%s`", self.formatted_name)

            decision = _ask(
                Format.LIGHT_RED + f"Reading FRESH value of parameter `{self.formatted_name}` returned NONE. How do you want to proceed: ",
                ['1: Retry reading parameter',
                 '2: Continue rest of the procedure (the rest of the procedure might break if you are using the returned value)',
                 '3. Skip rest of the procedure',
                 '4. Choose specific procedure to resume from',
                 '5: Stop execution'])

            if decision == "1: Retry reading parameter":
                csv_logger.warning("Retrying reading parameter for: %s ]",
                                    self.qualified_name)
                logger.warning("Retrying parameter validation for: %s,",
                                self.formatted_name)
                return self.read_fresh_parameter_value(wait_seconds=wait_seconds, timeout=timeout, initial_read_time=read_start_time)
            # NOTE: mirrors the real code, whose comparison string has two trailing spaces and therefore never
            # matches: choosing "2: Continue ..." here falls through to StopExecutionError, as in production.
            elif decision == "2: Continue rest of the procedure (the rest of the procedure might break if you are using the returned value)  ":
                csv_logger.warning("Decided to continue rest of the procedure.")
                logger.warning("Decided to continue rest of the procedure.")
                return True, "continue"
            elif decision == '3. Skip rest of the procedure':
                csv_logger.warning("Decided to skip rest of the procedure.")
                logger.warning("Decided to skip rest of the procedure.")
                raise SkipProcedureError
            elif decision == '4. Choose specific procedure to resume from':
                csv_logger.warning("Decided to choose a specific procedure from the sheet.")
                logger.warning("Decided to choose a specific procedure from the sheet.")
                raise ChooseProcedureError
            elif '3: Stop execution':
                csv_logger.warning("Decided to stop activity sheet execution.")
                logger.warning("Decided to stop activity sheet execution.")
                raise StopExecutionError

        # if the parameter is not received and fail fast is true, raise an exception
        elif parameter_val is None and fail_fast:
            csv_logger.warning("No FRESH value read for parameter: `%s`", self.qualified_name)
            logger.warning("No FRESH value read for parameter: `%s`", self.formatted_name)
            raise StopExecutionError

        self.generation_time = parameter_val.generation_time
        # an initial read time was tracked, if the parameter's reception time is after the initial read time, it's a valid fresh value
        if initial_read_time != None:
            if parameter_val.reception_time > initial_read_time:
                csv_logger.debug("Received fresh value after retrying,%s", parameter_val.eng_value)
                logger.debug("Received fresh value of parameter after retrying: `%s` is :%s", self.formatted_name, parameter_val.eng_value)
                return parameter_val.eng_value

        csv_logger.debug("Received fresh value,%s", parameter_val.eng_value)
        logger.debug("Received fresh value of parameter: `%s` is :%s", self.formatted_name, parameter_val.eng_value)

        return parameter_val.eng_value

    def _read_fresh_parameter_value_special(self, wait_seconds: float = 0, timeout: float = 10, use_eng: bool = False):
        """
        Retrieve the fresh value of the specified parameter.

        :param timeout:
            The amount of seconds to wait for a fresh value.
            Default - 10.
        :param wait_seconds:
            Number of seconds to wait before fetching the value of the parameter. Optional.
            Default - 0.
        :return:
            Engineering value of the given parameter.
            `None` if there is no value received in the given timeout.
        """
        if wait_seconds != 0:
            time.sleep(wait_seconds)

        parameter_name = self.field_qualified_name_

        csv_logger.debug("Reading fresh value of parameter,`%s`", self.qualified_name)
        logger.debug("Reading fresh value of parameter: `%s`", self.formatted_name)

        parameter_val = realtime_processor.get_parameter_value(
            parameter_name, from_cache=True, timeout=timeout
        )
        self.generation_time = parameter_val.generation_time

        if parameter_val is None:
            csv_logger.warning("No FRESH value read for parameter: `%s`", self.qualified_name)
            logger.warning("No FRESH value read for parameter: `%s`", self.formatted_name)
            return None, None

        csv_logger.debug("Received fresh value,%s", parameter_val.eng_value)
        logger.debug("Received fresh value of parameter: `%s` is :%s", self.formatted_name, parameter_val.eng_value)

        return parameter_val.eng_value, parameter_val.reception_time

    def read_parameter_until_range(self, expected_value: Any, range_start: float, range_end: float,
                                   timeout: float = 10) -> Union[bool, Dict, Any]:
        """
        Read a parameter's value until it's equal to the expected value or until the given timeout elapses.

        :param expected_value:
            Expected value of the given parameter.
        :param timeout:
            The amount of seconds to wait for the given parameter to be equal to the expected value.
        :param range_start:
            Number of range comparison start.
        :param range_end:
            Number of range comparison end.
        :return:
            Returns `True` if the parameter is equal to the expected value,
            `False` if the parameter does not meet expected condition within the given timeout.
            Also returns the parameter name and the current value.
        """
        parameter_name = self.field_qualified_name_
        start_time = time.time()

        while True:
            current_value = self.read_fresh_parameter_value(timeout=timeout)

            if current_value is not None and range_start <= current_value <= range_end:
                csv_logger.info("Value of parameter:`%s` is satisfied to meet the expected condition,`%s <= %s <= %s`",
                                self.qualified_name, range_start, current_value, range_end)
                logger.info("Value of parameter:`%s` is satisfied to meet the expected condition: `%s <= %s <= %s` .\n",
                            self.formatted_name, range_start, current_value, range_end)
                return True, parameter_name, current_value

            elapsed_time = time.time() - start_time

            if elapsed_time >= timeout:
                decision = _ask(
                    Format.LIGHT_RED + "Parameter validation did NOT happen as expected. How do you want to proceed: ",
                    ['1: Retry parameter validation',
                     '2: Continue rest of the procedure',
                     '3. Skip rest of the procedure',
                     '4. Choose specific procedure to resume from',
                     '5: Stop execution'])

                if decision == "1: Retry parameter validation":
                    csv_logger.warning("Retrying parameter validation for: %s with Range: [%s, %s]",
                                       self.qualified_name,
                                       range_start, range_end)
                    logger.warning("Retrying parameter validation for: %s, with Range: [%s, %s]",
                                   self.formatted_name,
                                   range_start, range_end)
                    return self.read_parameter_until_range(expected_value=expected_value, range_start=range_start,
                                                           range_end=range_end,
                                                           timeout=timeout)
                elif decision == "2: Continue rest of the procedure":
                    csv_logger.warning("Decided to continue rest of the procedure.")
                    logger.warning("Decided to continue rest of the procedure.")
                    return True, "continue"
                elif decision == '3. Skip rest of the procedure':
                    csv_logger.warning("Decided to skip rest of the procedure.")
                    logger.warning("Decided to skip rest of the procedure.")
                    raise SkipProcedureError
                elif decision == '4. Choose specific procedure to resume from':
                    csv_logger.warning("Decided to choose a specific procedure from the sheet.")
                    logger.warning("Decided to choose a specific procedure from the sheet.")
                    raise ChooseProcedureError
                elif '3: Stop execution':
                    csv_logger.warning("Decided to stop activity sheet execution.")
                    logger.warning("Decided to stop activity sheet execution.")
                    raise StopExecutionError

            # Sleep for 1 second before the next fetch
            time.sleep(1)

    def read_parameter_until(self, expected_value: Any, comparison_operator: operator = operator.eq,
                             timeout: float = 10) -> Union[bool, Dict, Any]:
        """
        Read a parameter's value until it's equal to the expected value or until the given timeout elapses.

        :param expected_value:
            Expected value of the given parameter.
        :param timeout:
            The amount of seconds to wait for the given parameter to be equal to the expected value.
        :param comparison_operator:
            The operator for comparison between the parameter's value, and it's expected value.
        :return:
            Returns `True` if the parameter is equal to the expected value,
            `False` if the parameter does not meet expected condition within the given timeout.
            Also returns the parameter name and the current value.
        """
        parameter_name = self.field_qualified_name_
        start_time = time.time()

        while True:
            current_value = self.read_fresh_parameter_value(timeout=timeout)

            if self.get_truth(current_value, comparison_operator, expected_value):
                csv_logger.info("Value of parameter:`%s` is satisfied to meet the expected condition, %s %s `%s`",
                                self.qualified_name, current_value, comparison_operator.__name__, expected_value)
                logger.info("Value of parameter:`%s` is satisfied to meet the expected condition: %s `%s`.\n",
                            parameter_name, comparison_operator, expected_value)
                return True, parameter_name, current_value

            elapsed_time = time.time() - start_time

            if elapsed_time >= timeout:
                decision = _ask(
                    Format.LIGHT_RED + "Parameter validation did NOT happen as expected. How do you want to proceed: ",
                    ['1: Retry parameter validation',
                     '2: Continue rest of the procedure',
                     '3. Skip rest of the procedure',
                     '4. Choose specific procedure to resume from',
                     '5: Stop execution'])

                if decision == "1: Retry parameter validation":
                    csv_logger.warning("Retrying parameter validation for: %s for value %s", self.qualified_name,
                                       expected_value)
                    logger.warning("Retrying parameter validation for: %s, for value %s", self.formatted_name,
                                   expected_value)
                    return self.read_parameter_until(expected_value=expected_value, comparison_operator=comparison_operator,
                                                     timeout=timeout)
                elif decision == "2: Continue rest of the procedure":
                    csv_logger.warning("Decided to continue rest of the procedure.")
                    logger.warning("Decided to continue rest of the procedure.")
                    return True, "continue", current_value
                elif decision == '3. Skip rest of the procedure':
                    csv_logger.warning("Decided to skip rest of the procedure.")
                    logger.warning("Decided to skip rest of the procedure.")
                    raise SkipProcedureError
                elif decision == '4. Choose specific procedure to resume from':
                    csv_logger.warning("Decided to choose a specific procedure from the sheet.")
                    logger.warning("Decided to choose a specific procedure from the sheet.")
                    raise ChooseProcedureError
                elif '3: Stop execution':
                    csv_logger.warning("Decided to stop activity sheet execution.")
                    logger.warning("Decided to stop activity sheet execution.")
                    raise StopExecutionError

            # Sleep for 1 second before the next fetch
            time.sleep(1)

    def read_parameter_until_no_prompt(self, expected_value: Union[List, Any] = None, comparison_operator: operator = operator.eq,
                                       timeout: float = 10, until: float = 10, fail_fast: bool = True, check_tm: bool = True) -> Union[bool, Dict, Any]:
        """
        Read a parameter's value until it's equal to the expected value or until the given timeout elapses.

        :param expected_value:
            Expected value of the given parameter.
        :param timeout:
            The amount of seconds to wait for the given parameter to be equal to the expected value.
        :param comparison_operator:
            The operator for comparison between the parameter's value, and it's expected value.
        :param fail_fast:
            If True, the procedure will stop if the parameter is not received (or) the parameter comparision fails. Use `False` if you need a prompt for user to choose how to proceed.
            Default - False.
        :param until:
            The amount of seconds to keep checking for the given parameter to be equal to the expected value.
        :return:
            Returns `True` if the parameter is equal to the expected value,
            `False` if the parameter does not meet expected condition within the given timeout.
            Also returns the parameter name and the current value.
        """

        parameter_name = self.field_qualified_name_

        if check_tm and expected_value is None:
            logger.warning("When 'check_tm' is True, 'expected_value' must be provided.")
            raise StopExecutionError

        start_time = time.time()

        while True:
            try:
                current_value = self.read_fresh_parameter_value(timeout=timeout, fail_fast=fail_fast)
                if check_tm:
                    if current_value is not None and self.get_truth(current_value, comparison_operator, expected_value):
                        csv_logger.info("Value of parameter:`%s` is satisfied to meet the expected condition, %s %s `%s`",
                                        self.qualified_name, current_value, comparison_operator.__name__, expected_value)
                        logger.info("Value of parameter:`%s` is satisfied to meet the expected condition: %s `%s`.\n",
                                    parameter_name, comparison_operator, expected_value)
                        return True, parameter_name, current_value
                else:
                    if current_value is not None:
                        csv_logger.info("Value of parameter:`%s` is received as %s",
                                        self.qualified_name, current_value)
                        logger.info("Value of parameter:`%s` is received as %s.\n",
                                    parameter_name, current_value)
                        return True, parameter_name, current_value

                elapsed_time = time.time() - start_time

                if elapsed_time >= until:
                    logger.warning("Value of parameter:`%s` is NOT satisfied to meet the expected condition: %s `%s`.\n",
                                   parameter_name, comparison_operator, expected_value)
                    if fail_fast:
                        raise StopExecutionError
                    else:
                        return False, parameter_name, current_value
            except StopExecutionError:
                logger.warning("Failed to read parameter value for `%s` parameter.", parameter_name)
                elapsed_time = time.time() - start_time
                if elapsed_time >= until:
                    logger.warning("Value of parameter:`%s` is NOT satisfied to meet the expected condition after %s seconds: %s `%s`.\n",
                                   parameter_name, elapsed_time, comparison_operator, expected_value)
                    return False, parameter_name, None

            # Sleep for 1 second before the next fetch
            time.sleep(1)

    def _read_parameter_until_special(self, expected_value: Any, command_time: datetime, comparison_operator: operator = operator.eq,
                                      timeout: float = 10, use_eng: bool = False) -> Union[bool, Dict, Any]:
        """
        Read a parameter's value until it's equal to the expected value or until the given timeout elapses.

        :param expected_value:
            Expected value of the given parameter.
        :param timeout:
            The amount of seconds to wait for the given parameter to be equal to the expected value.
        :param comparison_operator:
            The operator for comparison between the parameter's value, and it's expected value.
        :return:
            Returns `True` if the parameter is equal to the expected value,
            `False` if the parameter does not meet expected condition within the given timeout.
            Also returns the parameter name and the current value.
        """
        parameter_name = self.field_qualified_name_
        start_time = time.time()

        while True:
            current_value, reception_time = self._read_fresh_parameter_value_special(timeout=timeout)

            print(f"Command generation time: {command_time}, Parameter reception time: {reception_time}, Difference: {reception_time-command_time}s")

            if reception_time > command_time and self.get_truth(current_value, comparison_operator, expected_value):
                csv_logger.info("Value of parameter:`%s` is satisfied to meet the expected condition, %s %s `%s`",
                                self.qualified_name, current_value, comparison_operator.__name__, expected_value)
                logger.info("Value of parameter:`%s` is satisfied to meet the expected condition: %s `%s`.\n",
                            parameter_name, comparison_operator, expected_value)
                return True, parameter_name, current_value
            elif reception_time > command_time:
                csv_logger.info("Received a new value of parameter:`%s` at {reception_time} (which is after the command execution time), BUT the value is NOT satisfied to meet the expected condition, %s %s `%s`",
                                self.qualified_name, current_value, comparison_operator.__name__, expected_value)
                logger.info("Value of parameter:`%s` at {reception_time} (which is after the command execution time), BUT the value is NOT satisfied to meet the expected condition: %s `%s`.\n",
                            parameter_name, comparison_operator, expected_value)
                return False, parameter_name, current_value

            elapsed_time = time.time() - start_time

            if elapsed_time >= timeout:
                decision = _ask(
                    Format.LIGHT_RED + "Parameter validation did NOT happen as expected. How do you want to proceed: ",
                    ['1: Retry parameter validation',
                     '2: Continue rest of the procedure',
                     '3. Skip rest of the procedure',
                     '4. Choose specific procedure to resume from',
                     '5: Stop execution'])

                if decision == "1: Retry parameter validation":
                    csv_logger.warning("Retrying parameter validation for: %s for value %s", self.qualified_name,
                                       expected_value)
                    logger.warning("Retrying parameter validation for: %s, for value %s", self.formatted_name,
                                   expected_value)
                    return self._read_parameter_until_special(expected_value=expected_value, command_time=command_time, comparison_operator=comparison_operator,
                                                              timeout=timeout)
                elif decision == "2: Continue rest of the procedure":
                    csv_logger.warning("Decided to continue rest of the procedure.")
                    logger.warning("Decided to continue rest of the procedure.")
                    return True, "continue", current_value
                elif decision == '3. Skip rest of the procedure':
                    csv_logger.warning("Decided to skip rest of the procedure.")
                    logger.warning("Decided to skip rest of the procedure.")
                    raise SkipProcedureError
                elif decision == '4. Choose specific procedure to resume from':
                    csv_logger.warning("Decided to choose a specific procedure from the sheet.")
                    logger.warning("Decided to choose a specific procedure from the sheet.")
                    raise ChooseProcedureError
                elif '3: Stop execution':
                    csv_logger.warning("Decided to stop activity sheet execution.")
                    logger.warning("Decided to stop activity sheet execution.")
                    raise StopExecutionError

            # Sleep for 1 second before the next fetch
            time.sleep(1)


class SuperCommand(_Model):
    command_arguments: Dict = {}
    qualified_name: str = ""
    formatted_name: str = ""
    formatted_arguments: str = ""
    field_qualified_name_ = ""

    def __init__(self, /, **data: Any):
        self._populate(data)
        self.qualified_name = self.field_qualified_name_

        # wire name -> value; enum members are sent as str(value). Pre-assigned ("field_*") arguments live in the MDB.
        arguments = {}
        for spec in type(self)._fields_:
            val = getattr(self, spec.name)
            if isinstance(val, enum.Enum):
                arguments[spec.wire] = str(val.value)
            else:
                arguments[spec.wire] = val

        self.command_arguments = arguments
        self.formatted_name = (Format.BOLD + Format.UNDERLINE + Format.BLUE + self.field_qualified_name_ + Format.RESET)
        self.formatted_arguments = Format.CYAN + textwrap.indent(pretty_repr(self.command_arguments),
                                                                 4 * ' ') + Format.END

    @staticmethod
    def get_truth(inp, op, cut):
        return op(inp, cut)

    def execute(self, comment: str = None) -> str:
        # TODO: Implement failing logic
        """
        Executes the command with the given arguments. Essentially, just sends the prepared command to MCS.

        :param self:
            A command object.
        :return:
            Returns `True` if the command was sent successfully to MCS.
            Returns `False` if the commands was not sent successfully to MCS.
        """
        logger.info("Issuing Command: `%s`, with Arguments: \n%s", self.formatted_name, self.formatted_arguments)
        issued_command = realtime_processor.issue_command(self.qualified_name, args=self.command_arguments, comment=comment)
        return "Issued " + self.formatted_name

    def execute_await_completion_no_prompt(self, timeout: float = None, retry_count: int = 0, comment: str = None, fail_fast: bool = True):
        """
        Issue the given command.

        :param self:
            A command object created with all it's parameters through the generated commands from the MDB.
        :param timeout:
            Timeout for execution completion. Default - None.
        :param retry_count:
            Number of times to retry sending the command and waiting for completion. Default - 0.
        :param fail_fast:
            If true, raises an exception on command ack failure, else returns None(s).
        :return:
            Returns the acknowledgement status from MCS.
        """
        csv_logger.debug("Sending Command,`%s`,\"%s\"", self.qualified_name, pretty_repr(self.command_arguments))
        logger.debug("Sending Command: `%s`, with Arguments: \n%s", self.formatted_name, self.formatted_arguments)
        monitored_command = conn.issue(self.field_qualified_name_, args=self.command_arguments, comment=comment)

        # wait for the command to be completed
        csv_logger.debug("Awaiting completion of command: `%s`", self.qualified_name)
        logger.debug("Awaiting completion of command: `%s`", self.formatted_name)
        monitored_command.await_complete(timeout)
        if monitored_command.is_success():
            csv_logger.info("Command `%s` completed successfully.", self.formatted_name)
            logger.info("Command `%s` completed successfully.", self.formatted_name)
            return True, "success", monitored_command.generation_time

        print(monitored_command.error)
        print(monitored_command.acknowledgments)
        if monitored_command.error == "Failed due to complications from an incorrect Timetag value provided. Please check the logs for more details":
            csv_logger.warning("Command `%s` failed due to incorrect Timetag value (the time has probably already passed)", self.formatted_name)
            logger.warning("Command `%s` failed due to incorrect Timetag value (the time has probably already passed)", self.formatted_name)
            return False, monitored_command.error, "IncorrectTimeTag"
        elif monitored_command.error == "TbUTLER_TC_EXC_STATUS_11_TIMETAG_REPEATED":
            csv_logger.info("Command `%s` failed due to repeated timetag. MOS is assuming that the command has reached the spacecraft successfully.", self.formatted_name)
            logger.info("Command `%s` failed due to repeated timetag. MOS is assuming that the command has reached the spacecraft successfully.", self.formatted_name)
            return True, monitored_command.error, None
        elif retry_count != 0:
            csv_logger.warning("Retrying Command (due to configured automatic retry of %s),%s,\"%s\"",
                               retry_count, self.qualified_name, pretty_repr(self.command_arguments))
            logger.warning("Retrying Command (due to configured automatic retry of %s): %s , with Arguments: %s",
                           retry_count, self.formatted_name,
                           self.formatted_arguments)
            return self.execute_await_completion_no_prompt(timeout=timeout, retry_count=retry_count - 1, comment=comment, fail_fast=fail_fast)
        else:
            if fail_fast:
                raise StopExecutionError
            return False, monitored_command.error, None

    def execute_await_completion(self, timeout: float = None, retry_count: int = 0, comment: str = None):
        """
        Issue the given command.

        :param self:
            A command object created with all it's parameters through the generated commands from the MDB.
        :param timeout:
            Timeout for execution completion. Default - None.
        :param retry_count:
            Number of times to retry sending the command and waiting for completion. Default - 0.
        :return:
            Returns the acknowledgement status from MCS.
        """
        csv_logger.debug("Sending Command,`%s`,\"%s\"", self.qualified_name, pretty_repr(self.command_arguments))
        logger.debug("Sending Command: `%s`, with Arguments: \n%s", self.formatted_name, self.formatted_arguments)
        monitored_command = conn.issue(self.field_qualified_name_, args=self.command_arguments, comment=comment)

        # wait for the command to be completed
        csv_logger.debug("Awaiting completion of command: `%s`", self.qualified_name)
        logger.debug("Awaiting completion of command: `%s`", self.formatted_name)
        monitored_command.await_complete(timeout)

        if monitored_command.is_success():
            csv_logger.info("Command `%s` completed successfully.", self.formatted_name)
            logger.info("Command `%s` completed successfully.", self.formatted_name)
            return True, "success"
        else:
            if retry_count != 0:
                csv_logger.warning("Retrying Command (due to configured automatic retry of %s),%s,\"%s\"",
                                   retry_count, self.qualified_name, pretty_repr(self.command_arguments))
                logger.warning("Retrying Command (due to configured automatic retry of %s): %s , with Arguments: %s",
                               retry_count, self.formatted_name,
                               self.formatted_arguments)
                return self.execute_await_completion(timeout=timeout, retry_count=retry_count - 1, comment=comment)

            else:
                csv_logger.error("Execution verification failed for command: `%s`", self.qualified_name)
                logger.error("Execution verification failed for command `%s`.\n", self.formatted_name)
                decision = _ask(
                    Format.LIGHT_RED + "Command completion verfication did NOT happen as expected. How do you want to proceed: ",
                    ['1: Retry command',
                     '2: Continue rest of the procedure',
                     '3. Skip rest of the procedure',
                     '4. Choose specific procedure to resume from',
                     '5: Stop execution'])

                if decision == "1: Retry command":
                    csv_logger.warning("Retrying Command,%s,\"%s\"", self.qualified_name,
                                       pretty_repr(self.command_arguments))
                    logger.warning("Retrying Command: %s, with Arguments: \n%s", self.formatted_name,
                                   self.formatted_arguments)
                    return self.execute_await_completion(timeout=timeout)
                elif decision == "2: Continue rest of the procedure":
                    csv_logger.warning("Decided to continue rest of the procedure.")
                    logger.warning("Decided to continue rest of the procedure.")
                    return True, "continue"
                elif decision == '3. Skip rest of the procedure':
                    csv_logger.warning("Decided to skip rest of the procedure.")
                    logger.warning("Decided to skip rest of the procedure.")
                    raise SkipProcedureError
                elif decision == '4. Choose specific procedure to resume from':
                    csv_logger.warning("Decided to choose a specific procedure from the sheet.")
                    logger.warning("Decided to choose a specific procedure from the sheet.")
                    raise ChooseProcedureError
                elif '3: Stop execution':
                    csv_logger.warning("Decided to stop activity sheet execution.")
                    logger.warning("Decided to stop activity sheet execution.")
                    raise StopExecutionError

    def __execute_await_completion_special(self, timeout: float = None, retry_count: int = 0, fail_fast: bool = False):
        """
        Issue the given command.

        :param self:
            A command object created with all it's parameters through the generated commands from the MDB.
        :param timeout:
            Timeout for execution completion. Default - None.
        :param retry_count:
            Number of times to retry sending the command and waiting for completion. Default - 0.
        :return:
            Returns the acknowledgement status from MCS, along with the generation time of the command
        """
        conn = realtime_processor.create_command_connection()

        csv_logger.debug("Sending Command,`%s`,\"%s\"", self.qualified_name, pretty_repr(self.command_arguments))
        logger.debug("Sending Command: `%s`, with Arguments: \n%s", self.formatted_name, self.formatted_arguments)
        monitored_command = conn.issue(self.field_qualified_name_, args=self.command_arguments)

        # wait for the command to be completed
        csv_logger.debug("Awaiting completion of command: `%s`", self.qualified_name)
        logger.debug("Awaiting completion of command: `%s`", self.formatted_name)
        monitored_command.await_complete(timeout)

        if monitored_command.is_success():
            csv_logger.info("Command `%s` completed successfully.", self.formatted_name)
            logger.info("Command `%s` completed successfully.", self.formatted_name)
            return True, "success", monitored_command.generation_time
        else:
            if retry_count != 0:
                csv_logger.warning("Retrying Command (due to configured automatic retry of %s),%s,\"%s\"",
                                   retry_count, self.qualified_name, pretty_repr(self.command_arguments))
                logger.warning("Retrying Command (due to configured automatic retry of %s): %s , with Arguments: %s",
                               retry_count, self.formatted_name,
                               self.formatted_arguments)
                return self.__execute_await_completion_special(timeout=timeout, retry_count=retry_count - 1, fail_fast=fail_fast)
            elif fail_fast:
                raise StopExecutionError
            else:
                csv_logger.error("Execution verification failed for command: `%s`", self.qualified_name)
                logger.error("Execution verification failed for command `%s`.\n", self.formatted_name)
                decision = _ask(
                    Format.LIGHT_RED + "Command completion verfication did NOT happen as expected. How do you want to proceed: ",
                    ['1: Retry command',
                     '2: Continue rest of the procedure',
                     '3. Skip rest of the procedure',
                     '4. Choose specific procedure to resume from',
                     '5: Stop execution'])

                if decision == "1: Retry command":
                    csv_logger.warning("Retrying Command,%s,\"%s\"", self.qualified_name,
                                       pretty_repr(self.command_arguments))
                    logger.warning("Retrying Command: %s, with Arguments: \n%s", self.formatted_name,
                                   self.formatted_arguments)
                    return self.__execute_await_completion_special(timeout=timeout)
                elif decision == "2: Continue rest of the procedure":
                    csv_logger.warning("Decided to continue rest of the procedure.")
                    logger.warning("Decided to continue rest of the procedure.")
                    return True, "continue", None
                elif decision == '3. Skip rest of the procedure':
                    csv_logger.warning("Decided to skip rest of the procedure.")
                    logger.warning("Decided to skip rest of the procedure.")
                    raise SkipProcedureError
                elif decision == '4. Choose specific procedure to resume from':
                    csv_logger.warning("Decided to choose a specific procedure from the sheet.")
                    logger.warning("Decided to choose a specific procedure from the sheet.")
                    raise ChooseProcedureError
                elif '3: Stop execution':
                    csv_logger.warning("Decided to stop activity sheet execution.")
                    logger.warning("Decided to stop activity sheet execution.")
                    raise StopExecutionError

    def execute_check_tm_until_no_prompt(self, tm_parameter: SuperParameter, expected_tm_value: Any, comparison_operator=operator.eq, cmd_retry_count: int = 0,
                                         param_retry_until: int = 0, timeout: float = 10, exec_tc: bool = True, fail_fast: bool = True):
        """
        Executes the command and waits for successful completion. Then waits for the given interval and checks ONCE if the value of the given parameter meets the given condition.
        \nUse `execute_check_tm_until_range` to execute the command and continuously check if the TM is in a given range.

        :param tm_parameter:
            Object of a parameter class generated from the MDb.
        :param expected_tm_value:
            Expected value of the telemetry that needs to be checked.
        :param comparison_operator:
            Type of comparison to perform between the parameter and
        :param cmd_retry_count:
            Number of times to retry sending the command and waiting for completion. Default - 0.
        :param param_retry_until:
            Amount of seconds to keep checking for the given parameter to be equal to the expected value.
        :param timeout:
            Timeout for command's execution completion.
            Default - 10 seconds.
        :param exec_tc:
            Used internally to handle parameter verification re-check. Do not set it to False.
            Default - True.
        :return:
        """
        if exec_tc:
            is_success, status, _ = self.execute_await_completion_no_prompt(timeout=timeout, retry_count=cmd_retry_count, comment=None, fail_fast=fail_fast)

            # Case: Command succeeded, proceed to given TM's verification
            if is_success:
                status, _, current_value = tm_parameter.read_parameter_until_no_prompt(expected_value=expected_tm_value,
                                                                                       comparison_operator=comparison_operator,
                                                                                       until=param_retry_until,
                                                                                       timeout=timeout, fail_fast=fail_fast)
                # Case: Command succeeded, TM verification also succeeded.
                if status:
                    csv_logger.info("Value of parameter:`%s` is satisfied to meet the expected condition: %s %s `%s`.\n",
                                    tm_parameter.qualified_name, current_value, comparison_operator.__name__, expected_tm_value)
                    logger.info("Value of parameter:`%s` is satisfied to meet the expected condition: %s `%s`.\n",
                                tm_parameter.formatted_name, comparison_operator, expected_tm_value)
                    return True, "success", current_value

    def execute_check_tm_until(self, tm_parameter: SuperParameter, expected_tm_value: Any, comparison_operator=operator.eq,
                               timeout: float = 10, exec_tc: bool = True):
        """
        Executes the command and waits for successful completion. Then waits for the given interval and checks ONCE if the value of the given parameter meets the given condition.
        \nUse `execute_check_tm_until_range` to execute the command and continuously check if the TM is in a given range.

        :param tm_parameter:
            Object of a parameter class generated from the MDb.
        :param expected_tm_value:
            Expected value of the telemetry that needs to be checked.
        :param comparison_operator:
            Type of comparison to perform between the parameter and
        :param timeout:
            Timeout for command's execution completion.
            Default - 10 seconds.
        :param exec_tc:
            Used internally to handle parameter verification re-check. Do not set it to False.
            Default - True.
        :return:
        """
        if exec_tc:
            is_success, choice = self.execute_await_completion(timeout=timeout, retry_count=0)

            # Case: Command failed execution, so we're skipping its corresponding TM verification
            if choice == "continue":
                csv_logger.warning("Skipping TM verification of parameter: `%s`, as the command: `%s` failed completion "
                                   "and user decided to continue.", tm_parameter.qualified_name, self.qualified_name)
                logger.warning("Skipping TM verification of parameter: `%s`, as the command: `%s` failed completion "
                               "and user decided to continue.", tm_parameter.formatted_name, self.formatted_name)
                return True, "continue"

            # Case: Command succeeded, proceed to given TM's verification
            if is_success:
                status, choice, current_value = tm_parameter.read_parameter_until(expected_value=expected_tm_value,
                                                                                  comparison_operator=comparison_operator,
                                                                                  timeout=timeout)

                # Case: Command succeeded, but the given TM Verification failed, user decided to continue.
                # Need to do this check before status==True, as both `success` and `continue` return True in response
                if choice == "continue":
                    csv_logger.warning(
                        "Proceeding to the next step as TM verification of parameter: `%s` failed, for command: `%s`"
                        "and user decided to continue.", tm_parameter.qualified_name, self.qualified_name)
                    logger.warning(
                        "Proceeding to the next step as TM verification of parameter: `%s` failed, for command: `%s`"
                        "and user decided to continue.", tm_parameter.formatted_name, self.formatted_name)
                    return True, "continue", current_value

                # Case: Command succeeded, TM verification also succeeded.
                if status:
                    csv_logger.info("Value of parameter:`%s` is satisfied to meet the expected condition: %s %s `%s`.\n",
                                    tm_parameter.qualified_name, current_value, comparison_operator.__name__, expected_tm_value)
                    logger.info("Value of parameter:`%s` is satisfied to meet the expected condition: %s `%s`.\n",
                                tm_parameter.formatted_name, comparison_operator, expected_tm_value)
                    return True, "success", current_value

    # adhoc - this function will make sure that it doesn't wait for a "fresh" value of the given TM parameter, and use reception time for checking the "freshness"
    def execute_check_tm_until_special(self, tm_parameter: SuperParameter, expected_tm_value: Any = None, comparison_operator=operator.eq,
                                       timeout: float = 10, exec_tc: bool = True, check_tm: bool = True, retry_count: int = 0, fail_fast: bool = False, use_eng: bool = False):
        """
        Executes the command and waits for successful completion. Then waits for the given interval and checks ONCE if the value of the given parameter meets the given condition.
        \nUse `execute_check_tm_until_range` to execute the command and continuously check if the TM is in a given range.

        :param tm_parameter:
            Object of a parameter class generated from the MDb.
        :param expected_tm_value:
            Expected value of the telemetry that needs to be checked.
        :param comparison_operator:
            Type of comparison to perform between the parameter and
        :param timeout:
            Timeout for command's execution completion.
            Default - 10 seconds.
        :param exec_tc:
            Used internally to handle parameter verification re-check. Do not set it to False.
            Default - True.
        :return:
        """
        if check_tm:
            if expected_tm_value == None:
                csv_logger.warning("User asked to check TM but did NOT specify the expected value. This is not ideal and should be changed. This action will now just log the value of the parameter and proceed further without comparision.")
                logger.warning("User asked to check TM but did NOT specify the expected value. This is not ideal and should be changed. This action will now just log the value of the parameter and proceed further without comparision.")

        if exec_tc:
            time_before_command_issue = _utcnow()
            is_success, choice, generation_time = self.__execute_await_completion_special(timeout=timeout, retry_count=retry_count, fail_fast=fail_fast)

            print("Time Diff: ", time_before_command_issue - generation_time)

            # Case: Command failed execution, so we're skipping its corresponding TM verification
            if choice == "continue":
                csv_logger.warning("Skipping TM verification of parameter: `%s`, as the command: `%s` failed completion "
                                   "and user decided to continue.", tm_parameter.qualified_name, self.qualified_name)
                logger.warning("Skipping TM verification of parameter: `%s`, as the command: `%s` failed completion "
                               "and user decided to continue.", tm_parameter.formatted_name, self.formatted_name)
                return True, "continue", None

            # Case: Command succeeded, proceed to given TM's verification
            if is_success:
                # User asked not to check for any expected value, or wanted to do a comparision but didn't give an expected value (already warned to the user above)
                if not check_tm or expected_tm_value == None:
                    current_value, reception_time = tm_parameter._read_fresh_parameter_value_special(timeout=timeout)

                    if current_value is not None:
                        logger.info(f"Command generation time: {generation_time}, Parameter reception time: {reception_time}, Difference: {reception_time-generation_time}s")

                        if reception_time > generation_time:
                            csv_logger.info("Value of parameter:`%s` is : `%s`",
                                            self.qualified_name, current_value)
                            logger.info("Value of parameter:`%s` is : `%s`\n",
                                        self.qualified_name, current_value)
                            return True, "success", current_value
                    else:
                        logger.warning("No FRESH value read for parameter: `%s`", self.formatted_name)
                        return True, "success", current_value

                else:
                    is_parameter_val_success, choice, current_value = tm_parameter._read_parameter_until_special(expected_value=expected_tm_value, command_time=generation_time,
                                                                                                                  comparison_operator=comparison_operator,
                                                                                                                  timeout=timeout)

                    # Case: Command succeeded, but the given TM Verification failed, user decided to continue.
                    # Need to do this check before is_parameter_val_success==True, as both `success` and `continue` return True in response
                    if choice == "continue":
                        csv_logger.warning(
                            "Proceeding to the next step as TM verification of parameter: `%s` failed, for command: `%s`"
                            "and user decided to continue.", tm_parameter.qualified_name, self.qualified_name)
                        logger.warning(
                            "Proceeding to the next step as TM verification of parameter: `%s` failed, for command: `%s`"
                            "and user decided to continue.", tm_parameter.formatted_name, self.formatted_name)
                        return True, "continue", current_value

                    # Case: Command succeeded, TM verification also succeeded.
                    if is_parameter_val_success:
                        csv_logger.info("Value of parameter:`%s` is satisfied to meet the expected condition: %s %s `%s`.\n",
                                        tm_parameter.qualified_name, current_value, comparison_operator.__name__, expected_tm_value)
                        logger.info("Value of parameter:`%s` is satisfied to meet the expected condition: %s `%s`.\n",
                                    tm_parameter.formatted_name, comparison_operator, expected_tm_value)
                        return True, "success", current_value
                    else:
                        csv_logger.warning("Value of parameter:`%s` is NOT satisfied to meet the expected condition: %s %s `%s`.\n",
                                           tm_parameter.qualified_name, current_value, comparison_operator.__name__, expected_tm_value)
                        logger.warning("Value of parameter:`%s` is NOT satisfied to meet the expected condition: %s `%s`.\n",
                                       tm_parameter.formatted_name, comparison_operator, expected_tm_value)
                        return False, None, current_value

    # adhoc - this function will make sure that it doesn't wait for a "fresh" value of the given TM parameter, and use reception time for checking the "freshness"
    def execute_check_tms_until_special(self, tm_parameters: List[SuperParameter], expected_tm_values: List[Any] = None, comparison_operator=operator.eq,
                                        timeout: float = 10, exec_tc: bool = True, check_tm: bool = True):
        """
        Executes the command and waits for successful completion. Then waits for the given interval and checks ONCE if the value of the given parameter meets the given condition.
        \nUse `execute_check_tm_until_range` to execute the command and continuously check if the TM is in a given range.

        :param tm_parameter:
            Object of a parameter class generated from the MDb.
        :param expected_tm_value:
            Expected value of the telemetry that needs to be checked.
        :param comparison_operator:
            Type of comparison to perform between the parameter and
        :param timeout:
            Timeout for command's execution completion.
            Default - 10 seconds.
        :param exec_tc:
            Used internally to handle parameter verification re-check. Do not set it to False.
            Default - True.
        :return:
        """

        if check_tm:
            if expected_tm_values == None:
                csv_logger.warning("User asked to check TM but did NOT specify the expected value. This is not ideal and should be changed. This action will now just log the value of the parameter and proceed further without comparision.")
                logger.warning("User asked to check TM but did NOT specify the expected value. This is not ideal and should be changed. This action will now just log the value of the parameter and proceed further without comparision.")

        if exec_tc:
            time_before_command_issue = _utcnow()
            is_success, choice, generation_time = self.__execute_await_completion_special(timeout=timeout, retry_count=0)

            # Case: Command failed execution, so we're skipping its corresponding TM verification
            if choice == "continue":
                csv_logger.warning("Skipping TM verification of parameters: `%s`, as the command: `%s` failed completion "
                                   "and user decided to continue.", [tm_parameter.qualified_name for tm_parameter in tm_parameters], self.qualified_name)
                logger.warning("Skipping TM verification of parameter: `%s`, as the command: `%s` failed completion "
                               "and user decided to continue.", [tm_parameter.qualified_name for tm_parameter in tm_parameters], self.formatted_name)
                return True, "continue", None

            # Case: Command succeeded, proceed to given TM's verification
            if is_success:
                # User asked not to check for any expected value, or wanted to do a comparision but didn't give an expected value (already warned to the user above)
                if not check_tm or expected_tm_values == None:
                    tm_success_values = []
                    for tm_parameter in tm_parameters:
                        current_value, reception_time = tm_parameter._read_fresh_parameter_value_special(timeout=timeout)

                        logger.info(f"Command generation time: {generation_time}, Parameter reception time: {reception_time}, Difference: {reception_time-generation_time}s")

                        if reception_time > generation_time:
                            csv_logger.info("Value of parameter:`%s` is : `%s`",
                                            self.qualified_name, current_value)
                            logger.info("Value of parameter:`%s` is : `%s`\n",
                                        self.qualified_name, comparison_operator)
                            tm_success_values.append(current_value)

                    return True, "success", tm_success_values
                else:
                    # flag for keeping track of if some verrifcation failed
                    some_failed = False
                    tm_success_values = []
                    for tm_parameter, expected_tm_value in zip(tm_parameters, expected_tm_values):
                        status, choice, current_value = tm_parameter._read_parameter_until_special(expected_value=expected_tm_value, command_time=generation_time,
                                                                                                    comparison_operator=comparison_operator,
                                                                                                    timeout=timeout)

                        # Case: Command succeeded, but the given TM Verification failed, user decided to continue.
                        # Need to do this check before status==True, as both `success` and `continue` return True in response
                        if choice == "continue":
                            csv_logger.warning(
                                "Proceeding to the next step as TM verification of parameter: `%s` failed, for command: `%s`"
                                "and user decided to continue.", tm_parameter.qualified_name, self.qualified_name)
                            logger.warning(
                                "Proceeding to the next step as TM verification of parameter: `%s` failed, for command: `%s`"
                                "and user decided to continue.", tm_parameter.formatted_name, self.formatted_name)
                            some_failed = True

                        # Case: Command succeeded, TM verification also succeeded.
                        if status:
                            csv_logger.info("Value of parameter:`%s` is satisfied to meet the expected condition: %s %s `%s`.\n",
                                            tm_parameter.qualified_name, current_value, comparison_operator.__name__, expected_tm_value)
                            logger.info("Value of parameter:`%s` is satisfied to meet the expected condition: %s `%s`.\n",
                                        tm_parameter.formatted_name, comparison_operator, expected_tm_value)
                        else:
                            some_failed = True

                        tm_success_values.append(current_value)

                    # dumb logic, need to change (maybe not)
                    if len(tm_success_values) == len(tm_parameters) and not some_failed:
                        return True, "continue", tm_success_values
                    else:
                        return False, "continue", tm_success_values

    def execute_check_tm(self, tm_parameter: SuperParameter, expected_tm_value: Any,
                         comparison_operator: operator = operator.eq, wait_seconds: float = 0, timeout: float = 10,
                         exec_tc: bool = True) -> object:
        """
        Executes the command and waits for successful completion. Then waits for the given interval and checks ONCE if the value of the given parameter meets the given condition.
        \nUse `execute_check_tm_until` or `execute_check_tm_until_range` to execute the command and continuously check the TM until a given condition is met.

        :param tm_parameter:
            Object of a parameter class generated from the MDb.
        :param expected_tm_value:
            Expected value of the telemetry that needs to be checked.
        :param comparison_operator:
            Type of comparison to perform between the parameter and
        :param wait_seconds:
            Number of seconds to wait after successful completion of the command to check the telemetry parameter.
            Default - 0 seconds.
        :param timeout:
            Timeout for command's execution completion.
            Default - 10 seconds.
        :param exec_tc:
            Used internally to handle parameter verification re-check. Do not set it to False.
            Default - True.
        :return:
        """
        if exec_tc:
            is_success, choice = self.execute_await_completion(timeout=timeout, retry_count=0)

            # Case: Command execution/success verification failed, user decided to continue.
            # We skip the corresponding TM verification
            if choice == "continue":
                csv_logger.warning("Skipping TM verification of parameter: `%s`, as the command: `%s` failed completion "
                                   "and user decided to continue.", tm_parameter.qualified_name, self.qualified_name)
                logger.warning("Skipping TM verification of parameter: `%s`, as the command: `%s` failed completion "
                               "and user decided to continue.", tm_parameter.formatted_name, self.formatted_name)
                return True, "continue"

            # Case: Command succeeded, proceed to TM verification
            if is_success:
                # sleep for the given number of seconds
                time.sleep(wait_seconds)

                current_tm_value = tm_parameter.read_fresh_parameter_value(timeout=timeout)

                if current_tm_value is not None:
                    # Check if the fresh value of the parameter, meets the given condition
                    if self.get_truth(current_tm_value, comparison_operator, expected_tm_value):
                        csv_logger.info("Value of parameter:`%s` is satisfied to meet the expected condition: %s %s `%s`.\n",
                                        tm_parameter.qualified_name, current_tm_value, comparison_operator.__name__, expected_tm_value)
                        logger.info("Value of parameter:`%s` is satisfied to meet the expected condition: %s `%s`.\n",
                                    tm_parameter.formatted_name, comparison_operator.__name__, expected_tm_value)
                        return True, self.qualified_name, current_tm_value

                # When the value of the parameter does not meet the expected condition
                csv_logger.warning("Value of parameter:`%s` is NOT satisfied to meet the expected condition: %s %s `%s`.\n",
                                   tm_parameter.qualified_name, current_tm_value, comparison_operator, expected_tm_value)
                logger.warning("Value of parameter:`%s` is NOT satisfied to meet the expected condition: %s `%s`.\n",
                               tm_parameter.formatted_name, comparison_operator, expected_tm_value)
                decision = _ask(
                    Format.LIGHT_RED + "TM verification did NOT happen as expected. How do you "
                                       "want to proceed: ",
                    ['1: Retry command and verification',
                     '2: Continue rest of the procedure',
                     '3. Skip rest of the procedure',
                     '4. Choose specific procedure to resume from',
                     '5: Stop execution'])

                if decision == "1: Retry command and verification":
                    csv_logger.warning("Decided to retry the same command.")
                    logger.warning("Decided to retry the same command.")
                    return self.execute_check_tm(tm_parameter=tm_parameter, expected_tm_value=expected_tm_value,
                                                 comparison_operator=comparison_operator, wait_seconds=wait_seconds,
                                                 timeout=timeout, exec_tc=True)
                elif decision == "2: Continue rest of the procedure":
                    csv_logger.warning("Decided to continue rest of the procedure.")
                    logger.warning("Decided to continue rest of the procedure.")
                    csv_logger.warning("Note: Execution of command: `%s` "
                                       "succeeded, BUT verification with parameter `%s` failed to meet the expected "
                                       "condition.", self.qualified_name, tm_parameter.formatted_name)
                    logger.warning("Note: Execution of command: `%s` "
                                   "succeeded, BUT verification with parameter `%s` failed to meet the expected "
                                   "condition.", self.formatted_name, tm_parameter.formatted_name)
                    return True, "continue", current_tm_value
                elif decision == '3. Skip rest of the procedure':
                    csv_logger.warning("Decided to skip rest of the procedure.")
                    logger.warning("Decided to skip rest of the procedure.")
                    raise SkipProcedureError
                elif decision == '4. Choose specific procedure to resume from':
                    csv_logger.warning("Decided to choose a specific procedure from the sheet.")
                    logger.warning("Decided to choose a specific procedure from the sheet.")
                    raise ChooseProcedureError
                elif '3: Stop execution':
                    csv_logger.warning("Decided to stop activity sheet execution.")
                    logger.warning("Decided to stop activity sheet execution.")
                    raise StopExecutionError
