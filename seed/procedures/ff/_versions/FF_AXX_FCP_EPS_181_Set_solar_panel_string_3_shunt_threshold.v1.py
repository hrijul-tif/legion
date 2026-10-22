import time
import framework.ff.commands as comm
import framework.ff.parameters as param
from framework.utils.log_helper import run_logger as logger

MISSION = "FF1"

def Set_solar_panel_string_3_shunt_threshold_Procedure(Pus_Acknowledgement_Flags: str, Threshold: float):

    # Get current thresholds first
    comm.EPSGetSlrPnlThrld(Pus_Acknowledgement_Flags=Pus_Acknowledgement_Flags).execute_await_completion()

    # Set the threshold
    comm.EPSSetSlrPnl3Thrld(Pus_Acknowledgement_Flags=Pus_Acknowledgement_Flags, Threshold=Threshold).execute_await_completion()

    # Read it back
    comm.EPSGetSlrPnlThrld(Pus_Acknowledgement_Flags=Pus_Acknowledgement_Flags).execute_await_completion()
    current = round(param.EPSSlrPnl3ShntThdVol().read_latest_parameter_value(),1)

    if current == Threshold:
        logger.info(f"Shunt threshold of solar panel string 3 successfully set to {Threshold}")
    else:
        logger.error(f"Failed to set solar panel string 3 shunt threshold to {Threshold}")
