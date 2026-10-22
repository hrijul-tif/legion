import framework.ff.commands as comm
import framework.ff.parameters as param

MISSION = "FF1"

  
def Set_SatDrive_heating_Procedure(Pus_Acknowledgement_Flags: str, Mode: str, Duration: int):

    if Duration <= 0:
        raise ValueError("Duration must be a positive number of seconds")

    dig_status = param.EPSPrpDigPhrlSt().read_fresh_parameter_value()
    act_status = param.EPSPrpActPhrlSt().read_fresh_parameter_value()

    if dig_status == 'On' and act_status == 'On':
        comm.PropulsionStartSatDrvHtng(Pus_Acknowledgement_Flags=Pus_Acknowledgement_Flags, Mode=Mode, Duration=Duration).execute_await_completion()
    else:
        raise ValueError("Digital or actuator line is off")

    heating_mode = param.PropulsionSatDrvCtrlSt().read_fresh_parameter_value(timeout=31)
    print(f'SatDriveHeatingMode: {heating_mode}')
    _,_,resval=comm.PropulsionGetSatDrvHtngDuration(Pus_Acknowledgement_Flags=Pus_Acknowledgement_Flags).execute_check_tm_until_special(param.PropulsionSatDriveHeatingDuration(), Duration)
    print(f'SatDriveHeatingDuration: {resval}')