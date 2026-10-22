import framework.ff.commands as comm
import framework.ff.parameters as param
from framework.utils.log_helper import run_logger as logger

MISSION = "FF1"

def Get_OBC_firmware_version_Procedure(Pus_Acknowledgement_Flags: str):
    OBC_Firmware_version = comm.OBCGetFirmwareVersion(Pus_Acknowledgement_Flags=Pus_Acknowledgement_Flags).execute_await_completion()
    OBC_Firmware_version = param.OBCFV().read_latest_parameter_value()
    logger.info(f"OBC Firmware version: {str(OBC_Firmware_version)[0]}.{str(OBC_Firmware_version)[1]}.{str(OBC_Firmware_version)[2]}")

    

