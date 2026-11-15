"""Persist token refresh cooldown without changing existing tokens or market data."""
from alembic import op
import sqlalchemy as sa

revision = '0004_token_refresh_state'
down_revision = '0003_data_freshness'
branch_labels = None
depends_on = None


def upgrade():
    if 'token_refresh_states' not in sa.inspect(op.get_bind()).get_table_names():
        op.create_table('token_refresh_states',
            sa.Column('key', sa.String(64), primary_key=True),
            sa.Column('next_attempt_at', sa.DateTime()),
            sa.Column('updated_at', sa.DateTime()))


def downgrade():
    raise RuntimeError('Preserve refresh coordination; restore a backup for rollback')
