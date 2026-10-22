export function procedureTemplate(name: string, mission: "FF" | "JTYU"): string {
  const pkg = mission === "FF" ? "ff" : "jtyu";
  const fn = name.replace(/[^A-Za-z0-9_]/g, "_").replace(/^(\d)/, "_$1");
  return `import operator

import framework.${pkg}.commands as comm
import framework.${pkg}.parameters as param
from framework.utils.log_helper import run_logger as logger

MISSION = "${mission === "FF" ? "FF1" : "JTYU"}"


def ${fn}(${mission === "FF" ? "Pus_Acknowledgement_Flags: comm.PusAckFlagsEnum" : ""}):
    """Describe what this procedure does, its preconditions and its expected outcome."""
    logger.info("Starting ${name}")

    # 1. Send a telecommand and wait for completion:
    #    comm.<Command>(${mission === "FF" ? "Pus_Acknowledgement_Flags=Pus_Acknowledgement_Flags, " : ""}...).execute_await_completion()
    # 2. Verify telemetry:
    #    param.<Parameter>().read_parameter_until(<expected>, operator.eq, timeout=10)

    logger.info("${name} complete")
`;
}
