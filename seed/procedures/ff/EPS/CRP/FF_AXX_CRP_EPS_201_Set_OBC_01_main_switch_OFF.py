import framework.ff.commands as comm
import framework.ff.parameters as param

MISSION = "FF1"

def Set_OBC_01_main_switch_OFF_Procedure(Pus_Acknowledgement_Flags: str):

    comm.EPSSwtObc1Mn(Pus_Acknowledgement_Flags=Pus_Acknowledgement_Flags, On_Off_State='Off').execute_check_tm_until(tm_parameter=param.EPSObc1MnSwtSt(), expected_tm_value='Off')
    param.EPSObdh5vMnHpCur().read_fresh_parameter_value()