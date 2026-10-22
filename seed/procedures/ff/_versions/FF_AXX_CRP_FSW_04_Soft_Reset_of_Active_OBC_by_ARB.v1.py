import framework.ff.commands as comm
import framework.ff.parameters as param
from framework.utils.log_helper import run_logger as logger
import time

MISSION = "FF1"

def Soft_Reset_of_Active_OBC_by_ARB_Procedure(Pus_Acknowledgement_Flags: comm.PusAckFlagsEnum):

    # Current reset counter of OBC
    b4_obc_reset = param.OBCResetCounter().read_fresh_parameter_value()

    # Send soft reset OBC command by Arbitrator
    obc_soft_reset_comm = comm.ArbitratorResetOBC(Pus_Acknowledgement_Flags=Pus_Acknowledgement_Flags).execute_await_completion()

    time.sleep(3)

    # Verification of ARB Reset
    last_reset_reason_obc = param.OBCLastResetReason().read_fresh_parameter_value()
    after_obc_reset = param.OBCResetCounter().read_fresh_parameter_value()

    if after_obc_reset - b4_obc_reset == 1:
        logger.info(f"\n OBC reset counter increased by 1")
    else:
        logger.error(f"\n OBC reset counter didn't increase by 1")

    logger.info(f"\n Last reset reason: {last_reset_reason_obc}")
