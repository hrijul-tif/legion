import framework.jtyu.parameters as param
from framework.utils.log_helper import run_logger as logger

MISSION = "JTYU"


def Housekeeping_Health_Check(min_bus_voltage: float = 28.0, max_bus_voltage: float = 42.0, max_body_rate: float = 0.05):
    """Read a handful of housekeeping parameters and range-check them.

    Checks the satellite bus voltage window, the absolute body rates reported by the gyro and the system / EPS modes.
    Only reads telemetry; sends no telecommand.
    """
    sys_mode = param.SYSSysMode().read_latest_parameter_value()
    eps_mode = param.EPSEpsMd().read_latest_parameter_value()
    logger.info("System mode: %s, EPS mode: %s", sys_mode, eps_mode)

    # EPS housekeeping is slow (about 30 s), so wait for a fresh sample
    # returns (True, name, value) on success; "continue" after a prompt answer is only (True, "continue")
    result = param.EPSSatBusMnVol().read_parameter_until_range(
        expected_value=None, range_start=min_bus_voltage, range_end=max_bus_voltage, timeout=45
    )
    if len(result) == 3:
        logger.info("Bus voltage %.2f V is within [%s, %s]", result[2], min_bus_voltage, max_bus_voltage)
    else:
        logger.warning("Bus voltage window check was waived by the operator")

    rates = {
        "X": param.AOCSIMUDPGyroCrctBodyXAnglrRate().read_fresh_parameter_value(timeout=20),
        "Y": param.AOCSIMUDPGyroCrctBodyYAnglrRate().read_fresh_parameter_value(timeout=20),
        "Z": param.AOCSIMUDPGyroCrctBodyZAnglrRate().read_fresh_parameter_value(timeout=20),
    }
    for axis, rate in rates.items():
        if rate is None or abs(rate) > max_body_rate:
            logger.error("Body rate %s = %s is outside +/-%s", axis, rate, max_body_rate)
        else:
            logger.info("Body rate %s = %.5f within +/-%s", axis, rate, max_body_rate)
