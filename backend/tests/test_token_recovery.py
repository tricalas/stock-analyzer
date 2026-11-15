"""Refresh coordination, bounded recovery and historical-gap regressions."""
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime,timedelta,timezone
from unittest.mock import MagicMock,patch
import httpx
import test_regressions as fixtures
from app.models import ApiTokenCache,TokenRefreshState,PipelineRun,PipelineItem,StockPriceHistory
from app.database import SessionLocal
from app.kis.kis_client import KISClient
from app.kis.token_refresh import KISTokenRetry
from app.workflow import create_run,schedule_recovery,record_issue,execute_unit,classify_error
from app.market_clock import latest_session,calendar
from app.crawlers.kis_history_crawler import KISHistoryCrawler

class TokenRecovery(unittest.TestCase):
    setUpClass=classmethod(fixtures.Regressions.setUpClass.__func__)
    setUp=fixtures.Regressions.setUp
    tearDown=fixtures.Regressions.tearDown
    headers=fixtures.Regressions.headers
    history=fixtures.Regressions.history

    def kis(self):
        c=KISClient('private-key','private-secret');c.client.close();c.client=MagicMock()
        c.client.post.return_value=httpx.Response(200,json={'access_token':'fresh-token','expires_in':86400})
        return c

    def token(self):
        c=self.kis();self.db.add(ApiTokenCache(provider='kis',cache_key=c._get_cache_key(),access_token='shared-token',expired_at=datetime.utcnow()+timedelta(hours=4)));self.db.commit();return c

    def test_expired_memory_reloads_shared_token_without_issuance(self):
        c=self.token();c.access_token='expired';c.token_expired_at=datetime.utcnow()-timedelta(seconds=1)
        c._ensure_token();self.assertEqual(c.access_token,'shared-token');c.client.post.assert_not_called()

    def test_parallel_clients_share_one_issue_and_durable_cache(self):
        clients=[self.kis() for _ in range(4)]
        with ThreadPoolExecutor(max_workers=4) as pool:list(pool.map(lambda c:c._ensure_token(),clients))
        self.assertEqual(sum(c.client.post.call_count for c in clients),1)
        self.assertEqual({c.access_token for c in clients},{'fresh-token'})
        self.assertEqual(self.db.query(ApiTokenCache).count(),1)

    def test_403_is_sanitized_and_cooldown_survives_new_client(self):
        c=self.kis();c.client.post.return_value=httpx.Response(403,json={'error_code':'EGW00133','error_description':'private-secret'})
        with self.assertRaises(KISTokenRetry) as raised:c._ensure_token()
        self.assertIn('EGW00133',str(raised.exception));self.assertNotIn('private-secret',str(raised.exception))
        other=self.kis()
        with self.assertRaisesRegex(KISTokenRetry,'cooldown'):other._ensure_token()
        other.client.post.assert_not_called()
        state=self.db.query(TokenRefreshState).one();state.next_attempt_at=datetime.utcnow()-timedelta(seconds=1);self.db.commit()
        other._ensure_token();self.assertEqual(other.access_token,'fresh-token')

    def test_real_and_paper_use_tokenP_and_independent_state(self):
        a=self.kis();b=self.kis();b.is_mock=False;b.base_url=b.REAL_BASE_URL
        a._ensure_token();b._ensure_token()
        self.assertTrue(a.client.post.call_args.args[0].endswith('/oauth2/tokenP'))
        self.assertTrue(b.client.post.call_args.args[0].endswith('/oauth2/tokenP'))
        self.assertEqual(self.db.query(TokenRefreshState).count(),2)

    def test_provider_expiry_uses_kst_and_does_not_extend_token(self):
        from zoneinfo import ZoneInfo
        c=self.kis();now=datetime.now(timezone.utc)
        expiry=(now+timedelta(hours=1)).astimezone(ZoneInfo('Asia/Seoul')).replace(tzinfo=None,microsecond=0)
        c.client.post.return_value=httpx.Response(200,json={'access_token':'fresh','expires_in':86400,'access_token_token_expired':str(expiry)})
        c._ensure_token();self.assertLess(abs((c.token_expired_at-now.replace(tzinfo=None)).total_seconds()-3600),2)

    def test_rejected_token_refreshed_once_and_history_replayed(self):
        c=self.token();c.client.get.side_effect=[httpx.Response(200,json={'rt_cd':'1','msg_cd':'EGW00123'},request=httpx.Request('GET','https://provider.example')),httpx.Response(200,json={'rt_cd':'0','output2':[{'xymd':'20261113'}]},request=httpx.Request('GET','https://provider.example'))]
        self.assertEqual(c.get_us_stock_ohlcv('AAPL'),[{'xymd':'20261113'}])
        self.assertEqual(c.client.post.call_count,1);self.assertEqual(c.client.get.call_count,2)

    def test_storage_failure_clears_unshared_token_and_hides_sql_details(self):
        c=self.kis()
        with patch.object(c,'_save_token_cache',side_effect=RuntimeError('secret-token')):
            with self.assertRaises(KISTokenRetry) as raised:c._ensure_token()
        self.assertNotIn('secret-token',str(raised.exception));self.assertIsNone(c.access_token)

    def test_failed_token_gets_delayed_workflow_retry(self):
        self.assertEqual(classify_error('403 Forbidden for https://openapivts.koreainvestment.com/oauth2/tokenP'),'token_error')
        run=create_run(self.db,scope='retry',stock_ids=[self.stock.id])
        with patch('app.workflow._collect',side_effect=KISTokenRetry('KIS token refresh cooldown')),patch('app.workflow.dispatch_run'):execute_unit(run.id)
        self.db.expire_all();run=self.db.get(PipelineRun,run.id);item=self.db.query(PipelineItem).one()
        self.assertEqual((item.history_status,item.history_attempts),('pending',1))
        self.assertGreater(run.next_attempt_at,datetime.utcnow()+timedelta(seconds=60))

    def daily(self,reason='KIS token refresh cooldown'):
        now=datetime.utcnow();session=latest_session(now)[0]
        run=create_run(self.db,daily_key='daily:'+str(session));run.status='partial';run.active_key=None;run.completed_at=now-timedelta(minutes=6)
        record_issue(self.db,self.stock.id,reason);self.db.commit();return now

    def test_partial_daily_gets_idempotent_automatic_recovery(self):
        now=self.daily();recovery=schedule_recovery(self.db,now)
        self.assertEqual(recovery.scope,'retry');self.assertTrue(recovery.daily_key.startswith('recovery:'))
        self.assertEqual(self.db.query(PipelineItem).filter_by(run_id=recovery.id).count(),1)
        self.assertIsNone(schedule_recovery(self.db,now))

    def test_recovery_backoff_and_limit_survive_new_db_session(self):
        now=self.daily()
        for _ in range(3):
            now+=timedelta(minutes=70);run=schedule_recovery(self.db,now);self.assertIsNotNone(run)
            run.status='partial';run.active_key=None;run.completed_at=now;self.db.commit()
            with SessionLocal() as other:self.assertIsNone(schedule_recovery(other,now+timedelta(minutes=1)))
        self.assertIsNone(schedule_recovery(self.db,now+timedelta(hours=2)))

    def test_empty_history_retried_once_and_integrity_failures_protected(self):
        now=self.daily('Provider omitted 196 existing history dates');self.assertIsNone(schedule_recovery(self.db,now))
        record_issue(self.db,self.stock.id,'No data received from API');self.db.commit()
        run=schedule_recovery(self.db,now);self.assertIsNotNone(run)
        run.status='partial';run.active_key=None;run.completed_at=now;self.db.commit()
        self.assertIsNone(schedule_recovery(self.db,now+timedelta(hours=2)))

    def test_internal_gap_is_collected_even_with_current_latest_bar(self):
        expected,_=latest_session();sessions=calendar().sessions_in_range(str(expected-timedelta(days=180)),str(expected))[-100:];missing=sessions[-3].date()
        self.db.add_all([StockPriceHistory(stock_id=self.stock.id,date=s.date(),open_price=10,high_price=11,low_price=9,close_price=10,volume=100,updated_at=datetime.utcnow()) for s in sessions if s.date()!=missing]);self.stock.history_records_count=99;self.db.commit()
        self.assertEqual(KISHistoryCrawler()._should_collect_history(self.stock,self.db),(True,'incremental',missing-timedelta(days=1)))

    def test_postgres_lock_contention_cannot_issue(self):
        c=self.kis();fake=MagicMock();fake.dialect.name='postgresql';fake.connect.return_value.execute.return_value.scalar.return_value=False
        with patch('app.database.engine',fake):
            with self.assertRaisesRegex(KISTokenRetry,'in progress'):c._ensure_token()
        c.client.post.assert_not_called();fake.connect.return_value.close.assert_called_once()
