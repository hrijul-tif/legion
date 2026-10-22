import framework.ff.commands as comm
import framework.ff.parameters as param
import framework.utils.commanding as ucomm
from datetime import timedelta

MISSION = "FF1"


def Set_maximum_pulse_duration_OBC_Procedure(Pus_Acknowledgement_Flags: str,Durations: list[int] ,Command_Timetag: str):
    
    offsets = ['Thruster_1','Thruster_2','Thruster_3','Thruster_4']


    if len(offsets) != len(Durations):
            raise ValueError("Max Pulse Duration Should be set for all thrusters")

    
    TT = ucomm.create_utc_time(Command_Timetag) 
    G1_TT = TT - timedelta(seconds=2)
    G2_TT = TT + timedelta(seconds=(len(Durations)+2))

    comm.PropulsionGetMaxPlsDrtnObc(Pus_Acknowledgement_Flags=Pus_Acknowledgement_Flags,Command_Timetag=G1_TT).execute_await_completion()

    
    
    for offset, Duration in zip(offsets, Durations):
        comm.PropulsionSetMaxPlsDrtnObc(Pus_Acknowledgement_Flags=Pus_Acknowledgement_Flags, offset=offset, Duration=Duration,Command_Timetag=TT).execute_await_completion()
        TT = TT + timedelta(seconds=1)
    
    comm.PropulsionGetMaxPlsDrtnObc(Pus_Acknowledgement_Flags=Pus_Acknowledgement_Flags,Command_Timetag=G2_TT).execute_await_completion()
