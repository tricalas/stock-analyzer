"""Separate quote timestamps and verified closed-session analysis dates."""
from alembic import op
import sqlalchemy as sa
from app.freshness import session_close
from app.market_clock import latest_session

revision = '0003_data_freshness'
down_revision = '0002_durable_operations'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    columns = {c['name'] for c in sa.inspect(bind).get_columns('stocks')}
    if 'refresh_days' not in {c['name'] for c in sa.inspect(bind).get_columns('pipeline_runs')}:
        op.add_column('pipeline_runs', sa.Column('refresh_days', sa.Integer(), nullable=False, server_default='0'))
    for column in (sa.Column('quote_updated_at', sa.DateTime()), sa.Column('history_completed_date', sa.Date()),
                   sa.Column('signal_as_of_date', sa.Date()), sa.Column('ma_signal_as_of_date', sa.Date())):
        if column.name not in columns:
            op.add_column('stocks', column)
    # Never invent a quote timestamp from Stock.updated_at, which also changes during analysis.
    if 'updated_at' not in {c['name'] for c in sa.inspect(bind).get_columns('stock_price_history')}:
        return  # Legacy rows without collection evidence remain unverified.
    for market in ('US', 'KR'):
        expected = latest_session(market=market)[0]
        rows = bind.execute(sa.text('''SELECT s.id,h.date,h.updated_at FROM stocks s
            JOIN stock_price_history h ON h.stock_id=s.id
            WHERE s.market=:market AND h.date=(SELECT max(p.date) FROM stock_price_history p
                WHERE p.stock_id=s.id AND p.date<=:expected)'''), {'market': market, 'expected': expected}).all()
        verified = {}
        for row in rows:
            from datetime import date, datetime
            day = date.fromisoformat(row.date) if isinstance(row.date, str) else row.date
            updated = datetime.fromisoformat(row.updated_at) if isinstance(row.updated_at, str) else row.updated_at
            close = session_close(day, market)
            if close is not None and updated is not None and updated >= close:
                verified[row.id] = day

        table = sa.table('stocks', sa.column('id', sa.Integer()), sa.column('history_completed_date', sa.Date()))
        ids = list(verified)
        for offset in range(0, len(ids), 200):
            batch = {key: verified[key] for key in ids[offset:offset+200]}
            bind.execute(table.update().where(table.c.id.in_(batch)).values(
                history_completed_date=sa.case(batch, value=table.c.id)))


def downgrade():
    raise RuntimeError('Preserve timestamp evidence; restore a backup for rollback')
