"""Baseline existing installations and upgrade price precision and signal identity."""
from alembic import op
import sqlalchemy as sa
import json
from app.database import Base
from app import models

revision = "0001_precision_signals"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    Base.metadata.create_all(bind)
    inspector = sa.inspect(bind)
    stock_columns = {c['name'] for c in inspector.get_columns('stocks')}
    needs_repair = 'history_precision_version' not in stock_columns
    for column in (
        sa.Column('history_updated_at', sa.DateTime()),
        sa.Column('signal_analyzed_at', sa.DateTime()),
        sa.Column('ma_signal_analyzed_at', sa.DateTime()),
        sa.Column('history_precision_version', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('history_records_count', sa.Integer(), server_default='0'),
    ):
        if column.name not in stock_columns:
            op.add_column('stocks', column)
    if 'timezone' not in {c['name'] for c in inspector.get_columns('users')}:
        op.add_column('users', sa.Column('timezone', sa.String(50), nullable=False, server_default='Asia/Seoul'))

    price_columns = inspector.get_columns('stock_price_history')
    integer_prices = [c for c in price_columns if c['name'] in ('open_price','high_price','low_price','close_price') and isinstance(c['type'], sa.Integer)]
    if integer_prices:
        needs_repair = True
        with op.batch_alter_table('stock_price_history') as batch:
            for col in integer_prices:
                batch.alter_column(col['name'], existing_type=col['type'], type_=sa.Float())

    signal_columns = {c['name'] for c in inspector.get_columns('stock_signals')}
    if 'ma_period' not in signal_columns:
        op.add_column('stock_signals', sa.Column('ma_period', sa.Integer(), nullable=False, server_default='0'))
        for row in bind.execute(sa.text('SELECT id, details FROM stock_signals')):
            try:
                period = int(json.loads(row.details or '{}').get('ma_period', 0))
            except (ValueError, TypeError, AttributeError):
                period = 0
            bind.execute(sa.text('UPDATE stock_signals SET ma_period=:period WHERE id=:id'), {'id': row.id, 'period': period})
    constraints = sa.inspect(bind).get_unique_constraints('stock_signals')
    old = next((c for c in constraints if c['name'] == 'unique_stock_signal'), None)
    if old and old['column_names'] != ['stock_id','signal_date','strategy_name','ma_period']:
        with op.batch_alter_table('stock_signals') as batch:
            batch.drop_constraint('unique_stock_signal', type_='unique')
            batch.create_unique_constraint('unique_stock_signal', ['stock_id','signal_date','strategy_name','ma_period'])
    if needs_repair:
        bind.execute(sa.text("UPDATE stocks SET ma90_price=NULL, history_updated_at=NULL, signal_analyzed_at=NULL, ma_signal_analyzed_at=NULL WHERE market='US'"))
        bind.execute(sa.text("UPDATE stock_signals SET is_active=false WHERE stock_id IN (SELECT id FROM stocks WHERE market='US')"))


def downgrade():
    raise RuntimeError('Price precision recovery is forward-only; restore a database backup to roll back')
