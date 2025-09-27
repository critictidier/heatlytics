class Config:
    DEBUG = False
    TESTING = False
    SECRET_KEY = "change-me"


class DevelopmentConfig(Config):
    DEBUG = True


class TestingConfig(Config):
    TESTING = True
    WTF_CSRF_ENABLED = False