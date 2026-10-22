import framework.ff.commands as comm
import framework.ff.parameters as param

MISSION = "FF1"

def Set_transmit_frequency_for_SBT_1_Procedure(Pus_Acknowledgement_Flags: comm.PusAckFlagsEnum, Frequency: int):

    if not 2200000000 <= Frequency <= 2290000000:
        raise ValueError(f"Frequency {Frequency} Hz is outside the S-band allocation")

    # Send command
    command = comm.SBandSetSbt1TxActvFrq(Pus_Acknowledgement_Flags=Pus_Acknowledgement_Flags, Frequency=Frequency).execute_check_tm_until(param.SBandSbt1TxActvFrq(), Frequency)
