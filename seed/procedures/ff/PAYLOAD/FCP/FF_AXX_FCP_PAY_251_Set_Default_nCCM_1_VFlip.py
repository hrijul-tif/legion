import framework.ff.commands as comm
import framework.ff.parameters as param

MISSION = "FF1"

def Set_Default_nCCM_1_VFlip_Procedure(Pus_Acknowledgement_Flags: str, State: int):

    # Send command
    comm.PayloadGetDefaultNccm1VFlip(Pus_Acknowledgement_Flags=Pus_Acknowledgement_Flags).execute_await_completion()
    comm.PayloadSetDefaultNccm1VFlip(Pus_Acknowledgement_Flags=Pus_Acknowledgement_Flags, State=State).execute_await_completion()
    comm.PayloadGetDefaultNccm1VFlip(Pus_Acknowledgement_Flags=Pus_Acknowledgement_Flags).execute_check_tm_until_special(param.PayloadDefaultNccm1SensorVFlip(), State)
