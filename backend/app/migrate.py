"""Run versioned schema migrations before starting a web or worker process."""
from pathlib import Path
from alembic import command
from alembic.config import Config
from sqlalchemy import text
from app.database import engine


def upgrade_database(target_engine=engine):
    config = Config(str(Path(__file__).resolve().parents[1] / 'alembic.ini'))
    with target_engine.connect() as connection:
        postgres = connection.dialect.name == 'postgresql'
        if postgres:
            connection.execute(text('SELECT pg_advisory_lock(813452901)'))
            connection.commit()
        try:
            config.attributes['connection'] = connection
            command.upgrade(config, 'head')
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            if postgres:
                connection.execute(text('SELECT pg_advisory_unlock(813452901)'))
                connection.commit()


if __name__ == '__main__':
    upgrade_database()
