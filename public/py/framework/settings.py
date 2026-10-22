"""Sandbox settings: the same attribute names as the real Settings object, with mock values.

The run worker updates MISSION / INSTANCE at the start of every run (see mos_sim.runner).
"""


class Settings(object):
    def __init__(self):
        self.ENVIRONMENT = 'sandbox'
        self.PROJECT_NAME = 'mission-operations-system'
        self.MISSION = 'FF'
        self.INSTANCE = 'ff1-sandbox'  # procedures do settings.INSTANCE.split("-")[0]
        self.YAMCS_USERNAME = 'sandbox'
        self.YAMCS_URL = 'mock://'
        self.YAMCS_PASSWORD = ''
        self.WDS_ENDPOINT = None
        self.WDS_PORT = None
        self.SLACK_BOT_TOKEN = None
        self.BACKEND_CORS_ORIGINS = []

    def __repr__(self):
        return 'Settings(%s)' % ', '.join('%s=%r' % kv for kv in sorted(vars(self).items()) if 'PASSWORD' not in kv[0])


settings = Settings()
