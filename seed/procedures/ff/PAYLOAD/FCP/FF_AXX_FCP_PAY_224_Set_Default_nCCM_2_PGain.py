import framework.ff.commands as comm
import framework.ff.parameters as param

MISSION = "FF1"

def Set_Default_nCCM_2_PGain_Procedure(Pus_Acknowledgement_Flags: str,PGain: int):

    # Send command
    comm.PayloadGetDefaultNccm2SensorPgain(Pus_Acknowledgement_Flags=Pus_Acknowledgement_Flags).execute_await_completion()
    comm.PayloadSetDefaultNccm2SensorPgain(Pus_Acknowledgement_Flags=Pus_Acknowledgement_Flags,PGain=PGain).execute_await_completion()
    comm.PayloadGetDefaultNccm2SensorPgain(Pus_Acknowledgement_Flags=Pus_Acknowledgement_Flags).execute_check_tm_until_special(param.PayloadDefaultNccm2SensorPgain(), PGain)
