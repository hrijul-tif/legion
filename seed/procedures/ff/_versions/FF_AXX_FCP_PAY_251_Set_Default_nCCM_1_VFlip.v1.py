import framework.ff.commands as comm
import framework.ff.parameters as param

MISSION = "FF1"

def Set_Default_nCCM_1_VFlip_Procedure(Pus_Acknowledgement_Flags: str, State: int):

    # Send command
    comm.PayloadSetDefaultNccm1VFlip(Pus_Acknowledgement_Flags=Pus_Acknowledgement_Flags, State=State).execute_await_completion()
