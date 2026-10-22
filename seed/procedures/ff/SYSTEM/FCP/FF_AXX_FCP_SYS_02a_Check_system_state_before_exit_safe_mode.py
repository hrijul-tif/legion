import framework.ff.parameters as param
from framework.settings import settings
import operator
import logging

MISSION = "FF1"
sat_id = settings.INSTANCE.split("-")[0].upper()

def Check_system_state_before_exit_safe_mode_Procedure():
    verifications = []

    # EPS mode check
    verifications.append(
        param.EPSEPSMode().read_parameter_until_no_prompt(
            expected_value=param.EpsMdEnum.NOMINAL.value, until=15
        )
    )

    # SatBus voltage checks
    verifications.append(
        param.EPSSatBusMnVol().read_parameter_until_no_prompt(
            expected_value=25.5, comparison_operator=operator.gt, until=15
        )
    )
    verifications.append(
        param.EPSSatBusMnVol().read_parameter_until_no_prompt(
            expected_value=29.2, comparison_operator=operator.lt, until=15
        )
    )

    # SatBus current checks
    verifications.append(
        param.EPSSatBusMnHpCur().read_parameter_until_no_prompt(
            expected_value=0.6, comparison_operator=operator.gt, until=15
        )
    )
    verifications.append(
        param.EPSSatBusMnHpCur().read_parameter_until_no_prompt(
            expected_value=3, comparison_operator=operator.lt, until=15
        )
    )

    # Reaction-wheels switch state checks
    verifications.append(
        param.EPSRwl1SwtSt().read_parameter_until_no_prompt(
            expected_value=param.SwtStEnum.ON.value, until=15
        )
    )
    verifications.append(
        param.EPSRwl2SwtSt().read_parameter_until_no_prompt(
            expected_value=param.SwtStEnum.ON.value, until=15
        )
    )
    verifications.append(
        param.EPSRwl3SwtSt().read_parameter_until_no_prompt(
            expected_value=param.SwtStEnum.ON.value, until=15
        )
    )

    # RWL4 depends on satellite ID
    expected_rwl4 = param.SwtStEnum.OFF.value if sat_id == "FF01" else param.SwtStEnum.ON.value
    verifications.append(
        param.EPSRwl4SwtSt().read_parameter_until_no_prompt(
            expected_value=expected_rwl4, until=15
        )
    )

    # Reaction-wheel momentum
    verifications.append(
        param.AOCSRwlBdyMomNorm().read_parameter_until_no_prompt(
            expected_value=0.1, comparison_operator=operator.lt, until=15
        )
    )

    # Body-rates
    verifications.append(
        param.AOCSGyroBdyInrtlCorrNormalizedDerived().read_parameter_until_no_prompt(
            expected_value=1, comparison_operator=operator.lt, until=15
        )
    )

    # Check results
    failed = [(p, s) for success, p, s in verifications if not success]
    if failed:
        logging.error("⚠️ Nominal system state check failed for the following parameters:")
        for parameter, state in failed:
            logging.error("Parameter: %s | State: %s", parameter, state)
        return False

    return True
