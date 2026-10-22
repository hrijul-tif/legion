import framework.ff.commands as comm
import framework.ff.parameters as param
import operator
from framework.utils.log_helper import run_logger as logger

MISSION = "FF1"

def FF_AXX_LEOP_SBAND_004a_S_band_1_pre_DSC_checkout_Procedure():

    # Check SBT-1 peripheral status
    sbt1_phrl_st = param.EPSSbt1PhrlSt.read_parameter_until(param.EPSSbt1PhrlSt(), expected_value='On')

    # Check active SBT
    active_sbt = param.ArbitratorActiveSBandTransmitter.read_parameter_until(param.ArbitratorActiveSBandTransmitter(), expected_value='SBT_2')

    # Check TM mode
    tm_mode = param.ArbitratorTmMode.read_parameter_until(param.ArbitratorTmMode(), expected_value='BUTLER_TM_MODE_RTM')