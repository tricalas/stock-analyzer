"""Durable workflow, incident and recovery API regressions without live services."""
import unittest
from datetime import datetime, timedelta, date, timezone
from unittest.mock import patch
import test_regressions as fixtures
from app.database import SessionLocal
from app.models import (PipelineRun, PipelineItem, TaskProgress, StockPriceHistory,
                        RecoveryIssue, OperationalAlert, ServiceCheck, StockTagAssignment)
from app.workflow import create_run, execute_unit, claim_run, record_issue, seed_issues
from app.monitoring import alert, check_result, evaluate_data, operational_tick
from app.market_clock import latest_session


class Operations(unittest.TestCase):
    setUpClass = classmethod(fixtures.Regressions.setUpClass.__func__)
    setUp = fixtures.Regressions.setUp
    tearDown = fixtures.Regressions.tearDown
    headers = fixtures.Regressions.headers
    history = fixtures.Regressions.history

    def run_until_done(self, run_id):
        with patch('app.workflow.dispatch_run'):
            for _ in range(20):
                execute_unit(run_id)
                self.db.expire_all()
                run=self.db.get(PipelineRun,run_id)
                if run.status in ('completed','partial','failed','cancelled'):
                    return run
        self.fail('Workflow did not terminate')

    def test_duplicate_daily_trigger_and_single_active_run(self):
        a=create_run(self.db,daily_key='daily:2026-11-03')
        b=create_run(self.db,daily_key='daily:2026-11-03')
        c=create_run(self.db,scope='retry')
        self.assertEqual((a.id,a.id),(b.id,c.id))
        self.assertEqual(self.db.query(PipelineRun).count(),1)

    def test_live_lease_excludes_duplicate_and_expired_lease_resumes(self):
        run=create_run(self.db)
        now=datetime.utcnow()
        self.assertTrue(claim_run(self.db,run.id,now))
        with SessionLocal() as other:
            self.assertIsNone(claim_run(other,run.id,now))
            self.assertTrue(claim_run(other,run.id,now+timedelta(minutes=7)))

    def test_strict_stage_order_and_completed_checkpoints_are_not_repeated(self):
        self.history(100)
        run=create_run(self.db)
        calls=[]
        with patch('app.crawlers.crawler_manager.CrawlerManager.update_stock_list',side_effect=lambda *_:calls.append('quotes') or {'success':1}), \
             patch('app.workflow._collect',side_effect=lambda *_:calls.append('history') or 'success'), \
             patch('app.signal_analyzer.signal_analyzer._analyze_stock',side_effect=lambda *_:calls.append('signals') or {}), \
             patch('app.ma_signal_analyzer.ma_signal_analyzer._analyze_stock',side_effect=lambda *_:calls.append('ma') or {}):
            final=self.run_until_done(run.id)
            execute_unit(run.id)
        self.assertEqual(calls,['quotes','history','signals','ma'])
        self.assertEqual(final.status,'completed')
        progress=self.db.query(TaskProgress).filter_by(task_id=run.id).one()
        self.assertEqual((progress.current_item,progress.total_items,progress.success_count),(4,4,1))

    def test_failed_history_cannot_reach_analysis_and_is_reported(self):
        run=create_run(self.db,scope='retry',stock_ids=[self.stock.id])
        with patch('app.workflow._collect',side_effect=RuntimeError('Provider omitted 20 existing history dates')), \
             patch('app.signal_analyzer.signal_analyzer._analyze_stock') as signals, \
             patch('app.ma_signal_analyzer.ma_signal_analyzer._analyze_stock') as ma:
            final=self.run_until_done(run.id)
        self.assertEqual(final.status,'partial')
        signals.assert_not_called();ma.assert_not_called()
        issue=self.db.get(RecoveryIssue,self.stock.id)
        self.assertEqual(issue.reason,'missing_history')
        self.assertEqual(self.db.query(TaskProgress).filter_by(task_id=run.id).one().failed_count,1)

    def test_temporary_error_waits_then_retries_without_losing_attempt(self):
        run=create_run(self.db,scope='retry',stock_ids=[self.stock.id])
        with patch('app.workflow._collect',side_effect=RuntimeError('Connection timeout')),patch('app.workflow.dispatch_run') as dispatch:
            execute_unit(run.id)
        self.db.expire_all()
        item=self.db.query(PipelineItem).one();run=self.db.get(PipelineRun,run.id)
        self.assertEqual((item.history_status,item.history_attempts),('pending',1))
        self.assertGreater(run.next_attempt_at,datetime.utcnow())
        dispatch.assert_not_called()

    def test_hard_crash_attempts_are_bounded(self):
        run=create_run(self.db,scope='retry',stock_ids=[self.stock.id])
        item=self.db.query(PipelineItem).one();item.history_attempts=3;self.db.commit()
        with patch('app.workflow._collect') as collect:
            final=self.run_until_done(run.id)
        collect.assert_not_called();self.assertEqual(final.status,'partial')

    def test_quote_failure_stops_downstream_and_can_resume(self):
        run=create_run(self.db)
        with patch('app.crawlers.crawler_manager.CrawlerManager.update_stock_list',return_value={'success':0}):
            final=self.run_until_done(run.id)
        self.assertEqual(final.status,'failed')
        self.assertEqual(self.db.query(PipelineItem).count(),0)
        with patch('app.routers.operations.dispatch_run'):
            response=self.client.post(f'/api/operations/runs/{run.id}/resume',headers=self.headers())
        self.assertEqual(response.status_code,200)
        self.db.expire_all();self.assertEqual(self.db.get(PipelineRun,run.id).status,'queued')

    def test_broker_failure_keeps_durable_run_queued(self):
        with patch('app.routers.operations.dispatch_run',side_effect=ConnectionError('offline')):
            response=self.client.post('/api/operations/runs',json={'scope':'all'},headers=self.headers())
        self.assertEqual(response.status_code,200)
        self.assertEqual(self.db.get(PipelineRun,response.json()['run_id']).status,'queued')

    def test_scheduler_recovers_expired_work_not_live_work(self):
        run=create_run(self.db)
        run.lease_until=datetime.utcnow()+timedelta(minutes=6);self.db.commit()
        with patch('app.monitoring.probes',return_value=[]),patch('app.monitoring.dispatch_run') as dispatch:
            operational_tick();dispatch.assert_not_called()
        run.lease_until=datetime.utcnow()-timedelta(seconds=1);self.db.commit()
        with patch('app.monitoring.probes',return_value=[]),patch('app.monitoring.dispatch_run') as dispatch:
            operational_tick();dispatch.assert_called_once_with(run.id)

    def test_issues_import_is_idempotent_and_does_not_touch_tags(self):
        self.stock.history_precision_version=0;self.db.commit()
        tags=self.db.query(StockTagAssignment).count()
        seed_issues(self.db);seed_issues(self.db)
        self.assertEqual(self.db.query(RecoveryIssue).count(),1)
        self.assertEqual(self.db.query(StockTagAssignment).count(),tags)

    def test_successful_recollection_resolves_issue(self):
        self.history(100)
        record_issue(self.db,self.stock.id,'No data');self.db.commit()
        run=create_run(self.db,scope='retry',stock_ids=[self.stock.id])
        with patch('app.crawlers.kis_history_crawler.kis_history_crawler._should_collect_history',return_value=(False,'skip',date.today())),patch('app.workflow.dispatch_run'):
            execute_unit(run.id)
        self.db.expire_all();self.assertEqual(self.db.get(RecoveryIssue,self.stock.id).status,'resolved')

    def test_mapping_preserves_original_stock_and_invalidates_analysis(self):
        record_issue(self.db,self.stock.id,'No data');self.db.commit()
        response=self.client.patch(f'/api/operations/recovery/{self.stock.id}',json={'provider_symbol':'TEST/A','provider_exchange':'NYS','notes':'Provider code verified'},headers=self.headers())
        self.assertEqual(response.status_code,200)
        self.db.refresh(self.stock)
        self.assertEqual((self.stock.symbol,self.stock.provider_symbol,self.stock.history_precision_version),('TEST','TEST/A',0))
        invalid=self.client.patch(f'/api/operations/recovery/{self.stock.id}',json={'provider_symbol':'https://evil.example'},headers=self.headers())
        self.assertEqual(invalid.status_code,422)

    def test_admin_api_and_acknowledgement_are_protected(self):
        for method,path,body in [('GET','/api/operations/overview',None),('GET','/api/operations/recovery',None),('GET','/api/operations/alerts',None),('POST','/api/operations/runs',{'scope':'all'}),('PATCH',f'/api/operations/recovery/{self.stock.id}',{})]:
            for headers,code in [({},401),(self.headers(self.user),403)]:
                self.assertEqual(self.client.request(method,path,json=body,headers=headers).status_code,code)

    def test_incident_threshold_ack_resolution_and_recurrence(self):
        for _ in range(2):
            check_result(self.db,'Worker',False,'No workers');self.db.commit()
        self.assertIsNone(self.db.get(OperationalAlert,'service:Worker'))
        check_result(self.db,'Worker',False,'No workers');self.db.commit()
        row=self.db.get(OperationalAlert,'service:Worker');self.assertEqual(row.status,'open')
        self.assertEqual(self.client.post('/api/operations/alerts/service:Worker/acknowledge',headers=self.headers()).status_code,200)
        self.db.refresh(row);self.assertIsNotNone(row.acknowledged_at)
        check_result(self.db,'Worker',True,'healthy');self.db.commit();self.assertEqual(row.status,'resolved')
        for _ in range(3):check_result(self.db,'Worker',False,'No workers');self.db.commit()
        self.assertEqual(row.status,'open');self.assertIsNone(row.acknowledged_at)
        self.assertEqual(self.db.query(OperationalAlert).count(),1)

    def test_missing_scheduler_heartbeat_is_visible(self):
        response=self.client.get('/api/operations/overview',headers=self.headers())
        self.assertEqual(response.status_code,200);self.assertTrue(response.json()['monitoring_stale'])

    def test_holiday_and_early_close_sessions(self):
        cases=[('2026-11-26T23:00:00+00:00','2026-11-25'),
               ('2026-11-27T18:19:00+00:00','2026-11-25'),
               ('2026-11-27T18:21:00+00:00','2026-11-27'),
               ('2026-07-06T20:21:00+00:00','2026-07-06'),
               ('2026-11-07T02:00:00+00:00','2026-11-06')]
        for now,expected in cases:
            self.assertEqual(latest_session(datetime.fromisoformat(now))[0].isoformat(),expected)

    def test_holiday_does_not_create_false_price_delay(self):
        self.db.add(StockPriceHistory(stock_id=self.stock.id,date=date(2026,11,25),close_price=123.4));self.db.commit()
        result=evaluate_data(self.db,datetime(2026,11,26,23,0));self.db.commit()
        self.assertEqual(result['stale_stocks'],0)
        self.assertIsNone(self.db.get(OperationalAlert,'data:stale'))

    def test_cancelled_pipeline_preserves_checkpoints_and_resumes_same_id(self):
        run=create_run(self.db,scope='retry',stock_ids=[self.stock.id])
        response=self.client.post(f'/api/tasks/{run.id}/cancel',headers=self.headers())
        self.assertEqual(response.status_code,200);self.db.expire_all()
        self.assertEqual(self.db.get(PipelineRun,run.id).status,'cancelled')
        with patch('app.routers.operations.dispatch_run'):
            response=self.client.post(f'/api/tasks/{run.id}/restart',headers=self.headers())
        self.assertEqual(response.json()['new_task_id'],run.id)

    def test_mapping_patch_is_allowed_by_production_cors(self):
        from app.config import settings
        response=self.client.options('/api/operations/recovery/1',headers={
            'Origin':settings.CORS_ORIGINS[0],'Access-Control-Request-Method':'PATCH',
            'Access-Control-Request-Headers':'authorization,content-type'})
        self.assertEqual(response.status_code,200)

    def test_mapping_cannot_change_during_collection(self):
        record_issue(self.db,self.stock.id,'No data');self.db.commit()
        create_run(self.db,scope='retry',stock_ids=[self.stock.id])
        response=self.client.patch(f'/api/operations/recovery/{self.stock.id}',json={'provider_symbol':'OTHER'},headers=self.headers())
        self.assertEqual(response.status_code,409)

    def test_stale_history_is_not_resolved_by_a_partial_response(self):
        from app.workflow import _collect
        self.db.add(StockPriceHistory(stock_id=self.stock.id,date=date(2026,1,1),close_price=100))
        self.db.commit()
        run=create_run(self.db,scope='retry',stock_ids=[self.stock.id])
        with patch('app.crawlers.kis_history_crawler.kis_history_crawler._should_collect_history',return_value=(False,'skip',date(2026,1,1))):
            with self.assertRaisesRegex(RuntimeError,'Stale history'):
                _collect(self.db,run,None,self.stock)

    def test_running_workflow_protects_its_stocks_from_deletion(self):
        run=create_run(self.db,scope='retry',stock_ids=[self.stock.id])
        response=self.client.delete(f'/api/stocks/{self.stock.id}',headers=self.headers())
        self.assertEqual(response.status_code,409)
