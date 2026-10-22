import framework.ff.commands as cmd
import framework.ff.parameters as param
import framework.utils.commanding as ucomm
from datetime import datetime,timezone,timedelta
import operator
from framework.utils.log_helper import run_logger as logger

MISSION = "FF1"

def Set_GyroAutoReconfig_St(Pus_Acknowledgement_Flags: cmd.PusAckFlagsEnum, bool_isGyroAutoReconfigON: cmd.GyroAutoReconfigEnum, command_Timetag: str):
    
    CommandTimetag_Set=ucomm.create_utc_time(command_Timetag)  
    Exec_time_PreGet = CommandTimetag_Set - timedelta(seconds=2)
    Exec_time_PostGet = CommandTimetag_Set + timedelta(seconds=2)
                
    cmd.AOCSGetGyroAutoReconfigSt(Pus_Acknowledgement_Flags=Pus_Acknowledgement_Flags,Command_Timetag=ucomm.create_utc_time(Exec_time_PreGet.isoformat())).execute_await_completion()
    cmd.AOCSGetGyroAutoReconfigSt(Pus_Acknowledgement_Flags=Pus_Acknowledgement_Flags,Command_Timetag=ucomm.create_utc_time(Exec_time_PostGet.isoformat())).execute_await_completion()
    cmd.AOCSSetGyroAutoReconfigSt(Pus_Acknowledgement_Flags=Pus_Acknowledgement_Flags, bool_isGyroAutoReconfigON=bool_isGyroAutoReconfigON, Command_Timetag=ucomm.create_utc_time(CommandTimetag_Set.isoformat())).execute_await_completion()
