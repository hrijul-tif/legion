import operator

import framework.jtyu.commands as comm
import framework.jtyu.parameters as param
from framework.utils.log_helper import run_logger as logger

MISSION = "JTYU"

# Jatayu's PUS TC acknowledgement flags are an aggregate argument; ask for acceptance and completion reports
ACK_FLAGS = {
    "pus_acceptance_flag": "Present",
    "pus_start_exec_flag": "NotPresent",
    "pus_progress_exec_flag": "NotPresent",
    "pus_completion_flag": "Present",
}


def Ping_and_TC_Counters(timeout: int = 20, max_rejected: int = 0):
    """Ping the on-board computer (PUS TC[17,1] are-you-alive) and check the telecommand counters.

    Precondition: the spacecraft (or Bifrost SILS) is up and the link is established.
    Expected: the ping completes and the OBC has rejected at most `max_rejected` telecommands.
    """
    logger.info("Sending are-you-alive to the OBC")
    comm.AreYouAliveAreYouAlive(pus_tc_acknowledgement_flags=ACK_FLAGS).execute_await_completion(timeout=timeout)

    received = param.FSWActvOBCTCRcvdCnt().read_latest_parameter_value()
    accepted = param.FSWActvOBCTCAcptdCnt().read_latest_parameter_value()
    rejected = param.FSWActvOBCTCRjctdCnt().read_latest_parameter_value()
    logger.info("Active OBC telecommands: received=%s accepted=%s rejected=%s", received, accepted, rejected)

    if received is None or rejected is None:
        logger.error("TC counters are not available in telemetry yet")
    elif not operator.le(rejected, max_rejected):
        logger.error("OBC rejected %s telecommand(s), expected at most %s", rejected, max_rejected)
    elif received < 1:
        logger.error("The OBC reports no received telecommand after the ping")
    else:
        logger.info("Ping acknowledged and TC counters are healthy")
