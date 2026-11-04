"""Regression coverage runs against disposable SQLite databases, without network calls."""
import os
import tempfile
import unittest
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from datetime import date, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import patch, MagicMock

_TEMP = tempfile.TemporaryDirectory(prefix='stock-analyzer-tests-')
os.environ.update(DATABASE_URL='sqlite:///' + _TEMP.name + '/tests.db', KIS_APP_KEY='', KIS_APP_SECRET='',
                  SECRET_KEY='test-secret-key-only-for-isolated-regressions', SUPER_PIN='',
                  ENABLE_AUTO_HISTORY_COLLECTION='false', ENVIRONMENT='test', REDIS_PRIVATE_URL='')

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text
import redis
from app.database import Base, engine, SessionLocal
from app.models import Stock, StockPriceHistory, StockSignal, User, StockTag
from app.auth import create_access_token, get_pin_hash
from app.main import app
from app.bootstrap import seed_default_tags
from app.migrate import upgrade_database
from app.crawlers.kis_history_crawler import KISHistoryCrawler
from app.ma_signal_analyzer import MASignalAnalyzer
from app.signal_analyzer import SignalAnalyzer
from app.config import Settings


class Regressions(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pin_hash = get_pin_hash('123456')

    def setUp(self):
        Base.metadata.drop_all(engine)
        Base.metadata.create_all(engine)
        self.db = SessionLocal()
        self.cache_patch = patch('app.cache._redis')
        cache = self.cache_patch.start()
        for method in ('get','setex','scan_iter','ping','incr','expire','eval'):
            getattr(cache, method).side_effect = redis.ConnectionError('offline test')
        from app.cache import invalidate_cache
        invalidate_cache()
        from app.login_limits import _attempts
        _attempts.clear()
        seed_default_tags(self.db)
        self.admin = User(nickname='Admin', pin_hash=self.pin_hash, is_admin=True)
        self.user = User(nickname='Member', pin_hash=self.pin_hash, is_admin=False)
        self.other = User(nickname='Other', pin_hash=self.pin_hash, is_admin=False)
        self.stock = Stock(symbol='TEST', name='Test stock', market='US', current_price=123.45,
                           history_precision_version=1, history_updated_at=datetime.utcnow())
        self.db.add_all([self.admin,self.user,self.other,self.stock]); self.db.commit()
        self.client = TestClient(app, raise_server_exceptions=False)

    def tearDown(self):
        self.db.close()
        self.client.close()
        self.cache_patch.stop()

    def headers(self, user=None):
        return {'Authorization':'Bearer '+create_access_token({'sub':(user or self.admin).user_token})}

    def history(self, count):
        self.db.add_all([StockPriceHistory(stock_id=self.stock.id, date=date.today()-timedelta(days=i),
            open_price=123.45, high_price=124.99, low_price=122.01, close_price=123.89, volume=100) for i in range(count)])
        self.stock.history_records_count=count
        self.db.commit()

    def test_partial_recovery_analyzes_successful_repairs_before_reporting_failure(self):
        from app.recover_history import recover_history
        with patch('app.recover_history.kis_history_crawler') as crawler, \
             patch('app.recover_history.signal_analyzer') as signals, \
             patch('app.recover_history.ma_signal_analyzer') as ma:
            crawler.collect_history_for_all_stocks.return_value={'success':True,'failed_count':1}
            with self.assertRaisesRegex(RuntimeError,'incomplete'):
                recover_history()
            signals.analyze_and_store_signals.assert_called_once_with(mode='all',days=180,force_full=False)
            ma.analyze_and_store_signals.assert_called_once_with(mode='all',days=180,force_full=False)

    def test_task_redelivery_reuses_existing_progress(self):
        from app.models import TaskProgress
        crawler=KISHistoryCrawler()
        for _ in range(2):
            result=crawler._collect_history_for_stocks([],180,self.db,task_id='redelivery-history')
            self.assertTrue(result['success'])
            SignalAnalyzer().analyze_and_store_signals(task_id='redelivery-signals')
            MASignalAnalyzer().analyze_and_store_signals(task_id='redelivery-ma')
        self.assertEqual(self.db.query(TaskProgress).count(),3)
        self.assertTrue(all(t.status=='completed' for t in self.db.query(TaskProgress).all()))

    def test_background_quote_refresh_finishes_progress(self):
        from app.models import TaskProgress
        with patch('app.routers.collection.last_crawl_time',None), \
             patch('app.routers.collection.crawler_manager.update_stock_list',
                   return_value={'success':1,'failed':0,'total':1}):
            response=self.client.post('/api/crawl/stocks?market=US',headers=self.headers())
        self.assertEqual(response.status_code,200)
        task=self.db.query(TaskProgress).filter_by(task_id=response.json()['task_id']).one()
        self.assertEqual(task.status,'completed')

    def test_compatibility_history_route_preserves_precision_and_404(self):
        from app.crawlers.kis_history_crawler import kis_history_crawler
        self.stock.history_precision_version=0;self.db.commit()
        provider=SimpleNamespace(get_us_stock_ohlcv=lambda **kw:[{'xymd':date.today().strftime('%Y%m%d'),
            'open':'0.75','high':'1.25','low':'0.50','clos':'0.99','tvol':'100'}])
        with patch.object(kis_history_crawler,'kis_client',provider):
            response=self.client.post(f'/api/stocks/{self.stock.id}/crawl-history',headers=self.headers())
        self.assertEqual(response.status_code,200)
        self.assertEqual(self.db.query(StockPriceHistory).one().close_price,0.99)
        self.assertEqual(self.client.post('/api/stocks/9999/crawl-history',headers=self.headers()).status_code,404)

    def test_celery_redis_transport_loads(self):
        # This catches missing runtime dependencies that an HTTP test never imports.
        from kombu.transport import get_transport_cls
        self.assertEqual(get_transport_cls('redis').driver_type,'redis')

    def test_shared_data_writes_require_admin(self):
        routes=[('DELETE',f'/api/stocks/{self.stock.id}'),('DELETE','/api/signals'),
                ('DELETE','/api/signals/ma'),('DELETE','/api/stocks/cleanup-etf'),
                ('DELETE','/api/stocks/cleanup-kr'),('DELETE','/api/stocks/cleanup-no-history?confirm=true'),
                ('DELETE','/api/stocks/cleanup-low-cap?confirm=true&secret=clean1000'),
                ('POST','/api/signals/refresh'),('POST','/api/signals/ma/refresh'),
                ('POST','/api/scheduler/trigger'),('POST','/api/stocks/collect-history'),
                ('POST','/api/admin/clear-cache')]
        for method,path in routes:
            with self.subTest(path=path):
                self.assertEqual(self.client.request(method,path).status_code,401)
                self.assertEqual(self.client.request(method,path,headers=self.headers(self.user)).status_code,403)
        self.assertIsNotNone(self.db.get(Stock,self.stock.id))

    def test_admin_delete_removes_related_data_and_missing_stock_is_404(self):
        self.history(3)
        stock_id = self.stock.id
        self.client.post(f'/api/stocks/{stock_id}/favorite',headers=self.headers(self.user))
        response=self.client.delete(f'/api/stocks/{stock_id}',headers=self.headers())
        self.assertEqual(response.status_code,200)
        self.assertEqual(self.db.query(StockPriceHistory).count(),0)
        self.db.expire_all()
        self.assertIsNone(self.db.get(Stock,stock_id))
        self.assertEqual(self.client.delete(f'/api/stocks/{stock_id}',headers=self.headers()).status_code,404)

    def test_cleanup_preview_preserves_data_and_uses_actual_history(self):
        self.history(3)
        self.stock.history_records_count=0;self.db.commit()
        response=self.client.delete('/api/stocks/cleanup-no-history?confirm=true',headers=self.headers())
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json()['deleted_count'],0)
        self.assertIsNotNone(self.db.get(Stock,self.stock.id))

    def test_missing_or_invalid_token_returns_401(self):
        self.assertEqual(self.client.get('/api/auth/me').status_code,401)
        self.assertEqual(self.client.get('/api/stocks',headers={'Authorization':'Bearer invalid'}).status_code,401)

    def test_running_tasks_route_is_not_shadowed(self):
        response=self.client.get('/api/tasks/running',headers=self.headers())
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json(),[])

    def test_login_and_disabled_super_pin(self):
        response=self.client.post('/api/auth/login',json={'nickname':'Member','pin':'123456'})
        self.assertEqual(response.status_code,200)
        self.assertFalse(response.json()['user']['is_admin'])
        self.assertEqual(self.client.post('/api/auth/login',json={'nickname':'Member','pin':'999999'}).status_code,401)

    def test_login_attempts_are_rate_limited(self):
        for _ in range(10):
            self.assertEqual(self.client.post('/api/auth/login',json={'nickname':'Member','pin':'000000'}).status_code,401)
        response=self.client.post('/api/auth/login',json={'nickname':'Member','pin':'123456'})
        self.assertEqual(response.status_code,429)
        self.assertEqual(response.headers['Retry-After'],'600')

    def test_favorite_and_dislike_aliases_are_user_scoped(self):
        path=f'/api/stocks/{self.stock.id}'
        self.assertEqual(self.client.post(path+'/favorite',headers=self.headers(self.user)).status_code,200)
        response=self.client.get('/api/favorites',headers=self.headers(self.user))
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json()['total'],1)
        self.assertEqual(self.client.get('/api/favorites',headers=self.headers(self.other)).json()['total'],0)
        self.assertEqual(self.client.post(path+'/dislike',headers=self.headers(self.user)).status_code,200)
        self.assertEqual(self.client.get('/api/dislikes',headers=self.headers(self.user)).json()['total'],1)
        self.assertEqual(self.client.delete(path+'/favorite',headers=self.headers(self.user)).status_code,200)
        self.assertEqual(self.client.get('/api/favorites',headers=self.headers(self.user)).json()['total'],0)

    def test_private_tags_are_not_visible_or_assignable(self):
        tag=StockTag(name='private',display_name='Private',user_token=self.other.user_token)
        self.db.add(tag);self.db.commit()
        self.assertEqual(self.client.post(f'/api/stocks/{self.stock.id}/tags/{tag.id}',headers=self.headers(self.user)).status_code,404)
        tags=self.client.get('/api/tags',headers=self.headers(self.user)).json()['tags']
        self.assertNotIn(tag.id,[t['id'] for t in tags])

    def test_share_class_symbols_use_kis_format(self):
        from app.kis.kis_client import KISClient
        client=object.__new__(KISClient)
        client.base_url='https://provider.example'
        client.client=MagicMock()
        client._get_headers=lambda _: {}
        client.client.get.return_value.json.return_value={'rt_cd':'0','output2':[]}
        for symbol, expected in {'BRK.B':'BRK/B','BRK B':'BRK/B','BRK.A':'BRK/A','WHR PRA':'WHR/A','ET PR I':'ET/I'}.items():
            client.get_us_stock_ohlcv(symbol,'NYS')
            self.assertEqual(client.client.get.call_args.kwargs['params']['SYMB'],expected)
        client.client.get.return_value.json.return_value={'rt_cd':'1','msg1':'Rate limit exceeded'}
        with self.assertRaises(RuntimeError):client.get_us_stock_ohlcv('AAPL')

    def test_new_listing_can_end_on_an_empty_history_page(self):
        crawler=KISHistoryCrawler()
        rows=[{'xymd':(date.today()-timedelta(days=i)).strftime('%Y%m%d'),
               'open':'10.5','high':'11.2','low':'10.1','clos':'10.8','tvol':'100'} for i in range(100)]
        provider=MagicMock();provider.get_us_stock_ohlcv.side_effect=[rows,[]]
        crawler.kis_client=provider
        result=crawler._collect_us_stock_history('NEW','NAS',date.today()-timedelta(days=180))
        self.assertEqual(len(result),100)

    def test_incomplete_repair_never_marks_old_prices_as_restored(self):
        self.stock.history_precision_version=0
        self.db.add(StockPriceHistory(stock_id=self.stock.id,date=date.today()-timedelta(days=300),close_price=100));self.db.commit()
        crawler=KISHistoryCrawler()
        crawler.kis_client=SimpleNamespace(get_us_stock_ohlcv=lambda **kw:[{'xymd':date.today().strftime('%Y%m%d'),
            'open':'10.5','high':'11.2','low':'10.1','clos':'10.8','tvol':'100'}])
        result=crawler.collect_history_for_stock(self.stock,db=self.db)
        self.assertFalse(result['success'])
        self.db.refresh(self.stock);self.assertEqual(self.stock.history_precision_version,0)

    def test_fractional_us_prices_survive_storage_and_api(self):
        crawler=KISHistoryCrawler()
        crawler.kis_client=SimpleNamespace(get_us_stock_ohlcv=lambda **kw:[{'xymd':date.today().strftime('%Y%m%d'),
            'open':'0.75','high':'1.25','low':'0.50','clos':'0.99','tvol':'100'}])
        result=crawler.collect_history_for_stock(self.stock,db=self.db)
        self.assertTrue(result['success'])
        row=self.db.query(StockPriceHistory).one()
        self.assertEqual(row.open_price,0.75);self.assertEqual(row.close_price,0.99)
        response=self.client.get(f'/api/stocks/{self.stock.id}/price-history',headers=self.headers(self.user))
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json()[0]['close_price'],0.99)

    def test_single_stock_sync_repairs_existing_us_prices(self):
        from app.crawlers.kis_history_crawler import kis_history_crawler
        self.stock.history_precision_version=0
        self.db.add(StockPriceHistory(stock_id=self.stock.id,date=date.today(),close_price=100));self.db.commit()
        provider=SimpleNamespace(get_us_stock_ohlcv=lambda **kw:[{'xymd':date.today().strftime('%Y%m%d'),
            'open':'0.75','high':'1.25','low':'0.50','clos':'0.99','tvol':'100'}])
        with patch.object(kis_history_crawler,'kis_client',provider):
            response=self.client.post(f'/api/stocks/{self.stock.id}/sync-history?days=180',headers=self.headers())
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json()['mode'],'full')
        self.db.expire_all()
        self.assertEqual(self.db.query(StockPriceHistory).one().close_price,0.99)
        self.assertEqual(self.db.get(Stock,self.stock.id).history_precision_version,1)

    def test_ma90_requires_90_valid_sessions_and_clears_stale_value(self):
        self.history(89);self.stock.ma90_price=100;self.db.commit()
        crawler=KISHistoryCrawler()
        self.assertIsNone(crawler._calculate_and_update_ma90(self.stock.id,self.db))
        self.db.refresh(self.stock);self.assertIsNone(self.stock.ma90_price)
        self.db.add(StockPriceHistory(stock_id=self.stock.id,date=date.today()-timedelta(days=89),close_price=123.89));self.db.commit()
        self.assertAlmostEqual(crawler._calculate_and_update_ma90(self.stock.id,self.db),123.89)

    def test_pending_precision_repairs_are_exposed_and_excluded_from_screener(self):
        self.stock.ma90_price=self.stock.current_price
        self.stock.history_precision_version=0;self.db.commit()
        response=self.client.get('/api/stocks/ma90-screener',headers=self.headers(self.user))
        self.assertEqual(response.status_code,200);self.assertEqual(response.json()['total'],0)
        response=self.client.get('/api/stocks',headers=self.headers(self.user))
        self.assertEqual(response.json()['stocks'][0]['history_precision_version'],0)
        response=self.client.get(f'/api/stocks/{self.stock.id}',headers=self.headers(self.user))
        self.assertEqual(response.json()['history_precision_version'],0)

    def test_precision_repair_never_skips_existing_integer_history(self):
        self.history(90);self.stock.history_precision_version=0;self.db.commit()
        self.assertEqual(KISHistoryCrawler()._should_collect_history(self.stock,self.db)[1],'full')

    def test_distinct_ma_periods_and_idempotent_signal_storage(self):
        signals=[dict(signal_type='buy', strategy_name='ma_support',signal_date=date.today(),signal_price=100,
                      current_price=101,return_percent=1,details={'ma_period':period}) for period in (20,60,90)]
        analyzer=MASignalAnalyzer()
        analyzer._save_signals(self.stock.id,signals+signals,self.db);self.db.commit()
        analyzer._save_signals(self.stock.id,signals,self.db);self.db.commit()
        rows=self.db.query(StockSignal).all()
        self.assertEqual(len(rows),3);self.assertEqual({r.ma_period for r in rows},{20,60,90})

    def test_numpy_signal_details_are_serializable(self):
        import numpy as np
        signal=dict(signal_type='buy',strategy_name='ma_support',signal_date=date.today(),signal_price=np.float64(100.5),
                    current_price=np.float64(101.0),return_percent=np.float64(0.5),details={'ma_period':np.int64(20),'count':np.int64(3)})
        MASignalAnalyzer()._save_signals(self.stock.id,[signal],self.db);self.db.commit()
        self.assertIn('"count":3',self.db.query(StockSignal).one().details)

    def test_analysis_timestamps_are_independent(self):
        self.history(90)
        self.stock.signal_analyzed_at=datetime.utcnow()+timedelta(seconds=1);self.db.commit()
        self.assertIn(self.stock.id,MASignalAnalyzer()._get_stock_ids_by_mode('all',None,self.db))
        self.stock.signal_analyzed_at=None;self.stock.ma_signal_analyzed_at=datetime.utcnow()+timedelta(seconds=1);self.db.commit()
        self.assertIn(self.stock.id,SignalAnalyzer()._get_stock_ids_by_mode('all',None,self.db))

    def test_analysis_failure_keeps_previous_signals_and_timestamp(self):
        self.history(90)
        self.db.add(StockSignal(stock_id=self.stock.id,signal_type='buy',signal_date=date.today(),
                               signal_price=100,strategy_name='ma_support',ma_period=20));self.db.commit()
        analyzer=MASignalAnalyzer()
        with patch.object(analyzer,'_save_signals',side_effect=RuntimeError('write failed')):
            with self.assertRaises(RuntimeError): analyzer._analyze_stock(self.stock.id,180,self.db)
        self.db.rollback()
        self.assertEqual(self.db.query(StockSignal).count(),1)
        self.db.refresh(self.stock);self.assertIsNone(self.stock.ma_signal_analyzed_at)

    def test_cors_uses_configured_origins(self):
        ok=self.client.options('/api/stocks',headers={'Origin':'http://localhost:3000','Access-Control-Request-Method':'GET'})
        denied=self.client.options('/api/stocks',headers={'Origin':'https://untrusted.example','Access-Control-Request-Method':'GET'})
        self.assertEqual(ok.headers.get('access-control-allow-origin'),'http://localhost:3000')
        self.assertNotIn('access-control-allow-origin',denied.headers)

    def test_production_rejects_default_secrets(self):
        for values in ({'SECRET_KEY':''},{'SUPER_PIN':'999999'},{'CORS_ORIGINS':'*'}):
            with self.subTest(values=values),self.assertRaises(ValueError):
                Settings(_env_file=None,ENVIRONMENT='production',**values)


class Migrations(unittest.TestCase):
    def test_legacy_sqlite_upgrade_preserves_rows_and_is_repeatable(self):
        legacy=create_engine('sqlite:///'+_TEMP.name+'/legacy.db')
        with legacy.begin() as conn:
            conn.execute(text('CREATE TABLE stocks (id INTEGER PRIMARY KEY, symbol TEXT, market TEXT, ma90_price FLOAT)'))
            conn.execute(text("INSERT INTO stocks VALUES (1, 'LEGACY', 'US', 100)"))
            conn.execute(text('CREATE TABLE users (id INTEGER PRIMARY KEY)'))
            conn.execute(text('CREATE TABLE stock_price_history (id INTEGER PRIMARY KEY, stock_id INTEGER, date DATE, open_price INTEGER, high_price INTEGER, low_price INTEGER, close_price INTEGER, volume BIGINT, CONSTRAINT unique_stock_date UNIQUE(stock_id,date))'))
            conn.execute(text("INSERT INTO stock_price_history VALUES (1,1,'2026-01-01',100,101,99,100,10)"))
            conn.execute(text('CREATE TABLE stock_signals (id INTEGER PRIMARY KEY, stock_id INTEGER, signal_date DATE, strategy_name TEXT, details TEXT, is_active BOOLEAN, CONSTRAINT unique_stock_signal UNIQUE(stock_id,signal_date,strategy_name))'))
            conn.execute(text("INSERT INTO stock_signals VALUES (1,1,'2026-01-01','ma_support',:details,true)"), {'details':'{"ma_period":20}'})
        upgrade_database(legacy);upgrade_database(legacy)
        with legacy.begin() as conn:
            self.assertEqual(conn.execute(text('SELECT count(*) FROM stock_price_history')).scalar(),1)
            self.assertIsNone(conn.execute(text('SELECT ma90_price FROM stocks')).scalar())
            self.assertEqual(conn.execute(text('SELECT ma_period FROM stock_signals')).scalar(),20)
            conn.execute(text('UPDATE stock_price_history SET close_price=100.75'))
            self.assertEqual(conn.execute(text('SELECT close_price FROM stock_price_history')).scalar(),100.75)
        self.assertIn('ma_signal_analyzed_at',[c['name'] for c in inspect(legacy).get_columns('stocks')])
        unique=inspect(legacy).get_unique_constraints('stock_signals')[0]
        self.assertIn('ma_period',unique['column_names'])
        legacy.dispose()


if __name__=='__main__':
    unittest.main()
