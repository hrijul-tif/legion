import framework.ff.commands as comm
import framework.ff.parameters as param
import operator

MISSION ="FF1"

def Exit_safe_mode_Procedure(Pus_Acknowledgement_Flags: comm.PusAckFlagsEnum):
    
    # Send exit safe mode command
    comm.SystemSetSatelliteToSafeMode(Pus_Acknowledgement_Flags=Pus_Acknowledgement_Flags, Trigger=comm.SetSafeModeLEEnum.EXIT.value).execute_check_tm_until_no_prompt(tm_parameter=param.SystemSysMode(),expected_tm_value=param.NumberOperationWITHALARMSFORSysModeEnum.IDLE.value,cmd_retry_count=5,param_retry_until=5)