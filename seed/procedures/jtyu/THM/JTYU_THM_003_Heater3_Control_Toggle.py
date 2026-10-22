import operator

import framework.jtyu.commands as comm
import framework.jtyu.parameters as param
from framework.utils.log_helper import run_logger as logger

MISSION = "JTYU"

ACK_FLAGS = {
    "pus_acceptance_flag": "Present",
    "pus_start_exec_flag": "NotPresent",
    "pus_progress_exec_flag": "NotPresent",
    "pus_completion_flag": "Present",
}


def Heater3_Control_Toggle(target: comm.SetHtr10CtrlStStatusEnum, timeout: int = 60, restore: bool = True):
    """Switch thermal heater 3 control to `target`, verify it in telemetry, then optionally restore the previous state.

    Precondition: THM housekeeping is flowing. Expected: Htr3_Ctrl_St telemetry follows the commanded state.
    """
    previous = param.THMHtr3CtrlSt().read_fresh_parameter_value(timeout=timeout)
    logger.info("Heater 3 control is currently %s", previous)

    comm.THMSetHtr3CtrlSt(Status=target, pus_tc_acknowledgement_flags=ACK_FLAGS).execute_await_completion(timeout=15)
    param.THMHtr3CtrlSt().read_parameter_until(target.value, operator.eq, timeout=timeout)
    logger.info("Heater 3 control now reports %s", target.value)

    if restore and previous is not None and previous != target.value:
        back = comm.SetHtr10CtrlStStatusEnum(previous)
        comm.THMSetHtr3CtrlSt(Status=back, pus_tc_acknowledgement_flags=ACK_FLAGS).execute_await_completion(timeout=15)
        param.THMHtr3CtrlSt().read_parameter_until(previous, operator.eq, timeout=timeout)
        logger.info("Heater 3 control restored to %s", previous)
