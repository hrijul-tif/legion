import framework.ff.commands as comm
import framework.ff.parameters as param
from framework.utils.log_helper import run_logger as logger

MISSION = "FF1"

def Set_Default_S_Band_Transmitter_Procedure(Pus_Acknowledgement_Flags: str, SBand: str):

    comm.ArbitratorGetDefaultSbtId(Pus_Acknowledgement_Flags=Pus_Acknowledgement_Flags).execute_await_completion()
    current_default_sbt = param.ArbitratorDefaultSbtId().read_fresh_parameter_value()

    if current_default_sbt == SBand:
        logger.info("Default SBT is already equal to required value")
        return
    
    Set_active_sbt = comm.ArbitratorSetDefaultSbtId(Pus_Acknowledgement_Flags=Pus_Acknowledgement_Flags, SBT=SBand).execute_await_completion()
    Is_Success,_,res_values = comm.ArbitratorGetDefaultSbtId(Pus_Acknowledgement_Flags=Pus_Acknowledgement_Flags).execute_check_tm_until_special(tm_parameter=param.ArbitratorDefaultSbtId(),expected_tm_value= SBand)
    if Is_Success:
        logger.info(f"Default SBT is changed to {SBand}")
    else:
        logger.error(f"Default SBT was not changed")

   