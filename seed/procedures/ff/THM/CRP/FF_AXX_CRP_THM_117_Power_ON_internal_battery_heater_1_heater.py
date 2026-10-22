import framework.ff.commands as comm
import framework.ff.parameters as param
from framework.utils.log_helper import run_logger as logger
import operator

def Set_Intbatt1_Heater_ON(Pus_Acknowledgement_Flags: comm.PusAckFlagsEnum):
    
    atc_status = param.ThermalIntbatt1ATcSt().read_latest_parameter_value()
    manual_on = 0

    if atc_status != 'Manual':
        Is_manual,_,_ = comm.ThermalSetIntbatt1ATcSt(Pus_Acknowledgement_Flags=Pus_Acknowledgement_Flags, Mode='Manual').execute_check_tm_until_special(param.ThermalIntbatt1ATcSt(),expected_tm_value='Manual',timeout=70)
       
        if Is_manual:
             manual_on = 1
        else:
             logger.error(f"\n INBATT1 ATC Status is not Manual")
             return

    elif atc_status == 'Manual':
        manual_on = 1
           
        
    if manual_on == 1:
        Is_power_on,_,_ = comm.ThermalSetIntbatt1HtrSt(Pus_Acknowledgement_Flags=Pus_Acknowledgement_Flags, Status='On').execute_check_tm_until_special(param.ThermalIntbatt1HtrSt(),expected_tm_value='On')
        
        if Is_power_on:
            logger.info(f"\n INBATT1 Heater is ON")
        else:
             logger.error(f"\n INBATT1 Heater is OFF")
           
    