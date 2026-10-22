import framework.ff.commands as comm
import framework.ff.parameters as param

MISSION = "FF1"

def are_you_alive_procedure(Pus_Acknowledgement_Flags: comm.PusAckFlagsEnum):
    
    is_success, result = comm.ArbitratorAreYouAlive(Pus_Acknowledgement_Flags=Pus_Acknowledgement_Flags).execute_await_completion()

    if is_success:
        are_you_alive = param.ArbitratorAreYouAlive().read_fresh_parameter_value()
        print(are_you_alive)
    else:
        return result