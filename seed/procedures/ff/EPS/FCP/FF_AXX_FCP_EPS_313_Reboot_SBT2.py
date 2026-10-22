import framework.ff.commands as comm
import framework.ff.parameters as param

MISSION = "FF1"

def Reboot_SBT2_Procedure(Pus_Acknowledgement_Flags: comm.PusAckFlagsEnum):
    comm.EPSRebootSbt(Pus_Acknowledgement_Flags= Pus_Acknowledgement_Flags,Sbt='SBT_2').execute_await_completion()