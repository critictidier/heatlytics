from .config import Config


def create_app(config_class: type[Config] = Config):
    from flask import Flask

    app = Flask(__name__)
    app.config.from_object(config_class)

    from .routes import bp as main_bp

    app.register_blueprint(main_bp)

    return app