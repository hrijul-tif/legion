import framework.ff.commands as comm
import framework.ff.parameters as param
from framework.utils.log_helper import run_logger as logger
import re

MISSION = "FF1"

def Set_Nominal_Bitrate_Procedure(Pus_Acknowledgement_Flags: comm.PusAckFlagsEnum, Bitrate: str):
   active_sbt = param.ArbitratorActiveSBandTransmitter().read_latest_parameter_value()
   tm_mode = param.ArbitratorTmMode().read_latest_parameter_value()
   br_float = float(re.search(r'\d+', Bitrate).group())
   print(Bitrate)
   print(br_float)

   if active_sbt =='SBT_1' :
        
        if tm_mode == 'BUTLER_TM_MODE_RTM' :
            Is_Success,_,res_values = comm.ArbitratorSetNominalBitrate(Pus_Acknowledgement_Flags=Pus_Acknowledgement_Flags, Bitrate=Bitrate).execute_check_tm_until_special(tm_parameter=param.SBandSbt1TxActvBrt(),expected_tm_value=Bitrate)
            if Is_Success:
                logger.info(f"\n Nominal Bitrate set to {Bitrate} for SBT-1")
            else:
                logger.error(f"\n Nominal Bitrate not set for SBT-1")
        else:
            Is_Success,_,res_values = comm.ArbitratorSetNominalBitrate(Pus_Acknowledgement_Flags=Pus_Acknowledgement_Flags, Bitrate=Bitrate).execute_await_completion()
        
   elif active_sbt == 'SBT_2' :
        
        if tm_mode == 'BUTLER_TM_MODE_RTM' :
            Is_Success,_,res_values = comm.ArbitratorSetNominalBitrate(Pus_Acknowledgement_Flags=Pus_Acknowledgement_Flags, Bitrate=Bitrate).execute_check_tm_until_special(tm_parameter=param.SBandSbt2TxActvBrt(),expected_tm_value=Bitrate)
            if Is_Success:
                logger.info(f"\n Nominal Bitrate set to {Bitrate} for SBT-2")
            else:
                logger.error(f"\n Nominal Bitrate not set for SBT-2")
        else:
            Is_Success,_,res_values = comm.ArbitratorSetNominalBitrate(Pus_Acknowledgement_Flags=Pus_Acknowledgement_Flags, Bitrate=Bitrate).execute_await_completion()

    
    
   


   