class SkipProcedureError(Exception):
    """
    Exception raised when the user wants to skip the whole procedure.
    """
    pass


class ChooseProcedureError(Exception):
    """
    Exception raised when the user wants to choose a specific procedure.
    """
    pass


class StopExecutionError(Exception):
    """
    Exception raised when the user wants stop executing the whole pass activity sheet.
    """
    pass
