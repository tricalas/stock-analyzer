"""Regression coverage for signal categories, complete filtering and freshness."""
import unittest
from datetime import datetime,timedelta
import test_regressions as fixtures
from app.models import StockSignal
from app.market_clock import latest_session

class SignalFeed(unittest.TestCase):
    setUpClass=classmethod(fixtures.Regressions.setUpClass.__func__)
    setUp=fixtures.Regressions.setUp
    tearDown=fixtures.Regressions.tearDown
    headers=fixtures.Regressions.headers

    def add(self,strategy='ma_support',value=1,day=None,period=None):
        end=latest_session()[0];s=self.stock
        s.history_completed_date=end;s.history_precision_version=1;s.history_records_count=100
        s.history_updated_at=datetime.utcnow()-timedelta(minutes=3)
        s.signal_as_of_date=s.ma_signal_as_of_date=end
        s.signal_analyzed_at=s.ma_signal_analyzed_at=datetime.utcnow()-timedelta(minutes=1)
        row=StockSignal(stock_id=s.id,strategy_name=strategy,signal_type='buy',signal_date=day or end,
            signal_price=100,current_price=101,return_percent=value,ma_period=period if period is not None else self.db.query(StockSignal).count()+1,
            details='{"ma_period":20}')
        self.db.add(row);self.db.commit();return row

    def get(self,path='/api/signals/ma'):
        r=self.client.get(path,headers=self.headers());self.assertEqual(r.status_code,200,r.text);return r.json()

    def test_categories_cannot_mix(self):
        self.add();trend=self.add('doji_star')
        ma=self.get();tr=self.get('/api/signals')
        self.assertEqual([s['strategy_name'] for s in ma['signals']],['ma_support'])
        self.assertEqual([s['id'] for s in tr['signals']],[trend.id])
        self.assertEqual((ma['category'],tr['category']),('ma','trendline'))
        self.assertIn('price_as_of',ma['signals'][0]);self.assertIsInstance(ma['signals'][0]['details'],dict)

    def test_filter_finds_a_match_beyond_first_unfiltered_page(self):
        target=self.add('golden_cross')
        for _ in range(35):self.add()
        result=self.get('/api/signals/ma?strategy=golden_cross&limit=1')
        self.assertEqual(result['total'],1);self.assertEqual(result['signals'][0]['id'],target.id)
        self.assertEqual(result['stats']['total_signals'],1);self.assertIsNone(result['next_skip'])

    def test_positive_negative_flat_unknown_are_disjoint_and_average_ignores_unknown(self):
        for value in (2,-1,0,None):self.add(value=value)
        stats=self.get()['stats']
        self.assertEqual([stats[k] for k in ('positive_returns','negative_returns','flat_returns','unknown_returns')],[1,1,1,1])
        self.assertEqual(stats['avg_return'],0.33)
        for query,expected in [('positive',2),('negative',-1),('flat',0),('unknown',None)]:
            r=self.get('/api/signals/ma?return_filter='+query);self.assertEqual(r['total'],1)
            self.assertEqual(r['signals'][0]['return_percent'],expected);self.assertEqual(r['stats']['total_signals'],1)

    def test_tied_dates_paginate_each_record_once_with_full_stats(self):
        ids=[self.add().id for _ in range(7)];found=[]
        for skip in (0,3,6):
            r=self.get(f'/api/signals/ma?skip={skip}&limit=3');found += [s['id'] for s in r['signals']]
            self.assertEqual(r['stats']['total_signals'],7);self.assertEqual(r['next_skip'],skip+3 if skip<6 else None)
        self.assertEqual(found,list(reversed(ids)))

    def test_search_and_literal_wildcard_handling(self):
        self.stock.symbol='AB_C';self.stock.name='한국 테스트';self.db.commit();self.add()
        for term in ('ab_c','한국','테스트'):self.assertEqual(self.get('/api/signals/ma?search='+term)['total'],1)
        self.assertEqual(self.get('/api/signals/ma?search=%25')['total'],0)
        self.assertEqual(self.get('/api/signals/ma?search=other')['stats']['stock_count'],0)

    def test_old_and_unknown_history_are_hidden_but_counted_as_exclusions(self):
        self.add();self.stock.history_completed_date=latest_session()[0]-timedelta(days=1);self.db.commit()
        r=self.get();self.assertEqual((r['total'],r['excluded_stale']),(0,1))
        self.stock.history_completed_date=None;self.db.commit();self.assertEqual(self.get()['excluded_stale'],1)

    def test_missing_price_precision_is_hidden(self):
        self.add();self.stock.history_precision_version=0;self.db.commit();self.assertEqual(self.get()['total'],0)

    def test_each_analysis_family_is_checked_independently(self):
        self.add();self.add('doji_star');self.stock.signal_as_of_date=None;self.db.commit()
        self.assertEqual(self.get()['total'],1);self.assertEqual(self.get('/api/signals')['total'],0)
        self.stock.signal_as_of_date=latest_session()[0];self.stock.ma_signal_as_of_date=None;self.db.commit()
        self.assertEqual(self.get()['total'],0);self.assertEqual(self.get('/api/signals')['total'],1)

    def test_new_history_invalidates_old_analysis_and_signal_rows(self):
        self.add();self.stock.history_updated_at=datetime.utcnow()+timedelta(seconds=1);self.db.commit()
        self.assertEqual(self.get()['total'],0)
        self.stock.ma_signal_analyzed_at=datetime.utcnow()+timedelta(seconds=2);self.db.commit()
        self.assertEqual(self.get()['total'],0)

    def test_inactive_stock_and_signal_are_excluded(self):
        row=self.add();row.is_active=False;self.db.commit();self.assertEqual(self.get()['total'],0)
        row.is_active=True;self.stock.is_active=False;self.db.commit();self.assertEqual(self.get()['total'],0)

    def test_window_is_anchored_to_completed_session_and_future_is_excluded(self):
        end=latest_session()[0];recent=self.add(day=end-timedelta(days=9))
        self.add(day=end-timedelta(days=10));self.add(day=end+timedelta(days=1))
        r=self.get();self.assertEqual([s['id'] for s in r['signals']],[recent.id])
        self.assertEqual(self.get('/api/signals/ma?days=30')['total'],2);self.assertEqual(r['expected_sessions']['US'],str(end))

    def test_global_sort_keeps_unknown_values_last(self):
        for value in (None,1,-2,0,3):self.add(value=value)
        self.assertEqual([s['return_percent'] for s in self.get('/api/signals/ma?sort=return_desc')['signals']],[3,1,0,-2,None])
        self.assertEqual([s['return_percent'] for s in self.get('/api/signals/ma?sort=return_asc')['signals']],[-2,0,1,3,None])

    def test_analysis_time_matches_category_and_filters(self):
        self.add();other=self.add('doji_star');other.analyzed_at=datetime.utcnow()+timedelta(hours=1);self.db.commit()
        self.assertNotEqual(self.get()['analyzed_at'],self.get('/api/signals')['analyzed_at'])
        self.assertIsNone(self.get('/api/signals/ma?search=unmatched')['analyzed_at'])

    def test_invalid_parameters_and_cross_category_strategies_are_rejected(self):
        for path in ['/api/signals/ma?strategy=doji_star','/api/signals?strategy=golden_cross','/api/signals/ma?days=0',
            '/api/signals/ma?days=31','/api/signals/ma?return_filter=bad','/api/signals?sort=bad','/api/signals?search='+('x'*51)]:
            self.assertEqual(self.client.get(path,headers=self.headers()).status_code,422,path)
        self.assertEqual(self.client.get('/api/signals/ma').status_code,401)

    def test_unknown_returns_do_not_become_zero(self):
        self.add(value=None);r=self.get();self.assertIsNone(r['stats']['avg_return']);self.assertEqual(r['stats']['flat_returns'],0)

    def test_insufficient_history_and_missing_timestamps_are_not_current(self):
        self.add();self.stock.history_records_count=80;self.db.commit();self.assertEqual(self.get()['total'],0)
        self.stock.history_records_count=100;self.stock.history_updated_at=None;self.db.commit()
        self.assertEqual(self.get()['excluded_stale'],1)
