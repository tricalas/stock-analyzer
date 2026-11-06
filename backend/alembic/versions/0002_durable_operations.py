"""Durable collection workflow, recovery issues and operational incidents."""
from alembic import op
import sqlalchemy as sa
from app.models import PipelineRun, PipelineItem, RecoveryIssue, OperationalAlert, ServiceCheck

revision = "0002_durable_operations"
down_revision = "0001_precision_signals"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    columns = {c['name'] for c in sa.inspect(bind).get_columns('stocks')}
    for column in (sa.Column('provider_symbol', sa.String(20)), sa.Column('provider_exchange', sa.String(3))):
        if column.name not in columns:
            op.add_column('stocks', column)
    for model in (PipelineRun, PipelineItem, RecoveryIssue, OperationalAlert, ServiceCheck):
        model.__table__.create(bind, checkfirst=True)


def downgrade():
    raise RuntimeError('Keep operational history; restore a backup for rollback')
