import framework.ff.commands as comm
import framework.ff.parameters as param

MISSION = "FF1"

def Set_S_Band_radio_01_redundant_switch_ON_Procedure(Pus_Acknowledgement_Flags: str):

    comm.EPSSwtSbt1Rd(Pus_Acknowledgement_Flags=Pus_Acknowledgement_Flags, On_Off_State='On').execute_check_tm_until(tm_parameter=param.EPSSbt1PhrlSt(), expected_tm_value='On')
