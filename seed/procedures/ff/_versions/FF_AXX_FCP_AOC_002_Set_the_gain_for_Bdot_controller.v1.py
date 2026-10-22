import framework.ff.commands as cmd
import framework.ff.parameters as param
import operator
from framework.utils.log_helper import run_logger as logger

MISSION = "FF1"

def Set_BdotCtrl_Gn(Pus_Acknowledgement_Flags: cmd.PusAckFlagsEnum, K_BdotController: float):

    Set_BdotCtrl_Gn = cmd.AOCSSetBdotCtrlGn(Pus_Acknowledgement_Flags=Pus_Acknowledgement_Flags, K_BdotController=K_BdotController).execute_await_completion()
    Is_Success,_,res_values = cmd.AOCSGetBdotCtrlGn(Pus_Acknowledgement_Flags=Pus_Acknowledgement_Flags).execute_check_tms_until_special([param.AOCSBdotCtrlGn()],[float(K_BdotController)])

    if Is_Success:
        logger.info("parameters of AOCSGetBdotCtrlGn updated successfully")
    else:
        logger.error("parameters of AOCSGetBdotCtrlGn are not updated")
