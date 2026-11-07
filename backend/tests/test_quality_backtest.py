import unittest
from datetime import date,datetime,timedelta
from unittest.mock import patch,MagicMock
import numpy as np
import pandas as pd
import test_regressions as fixtures
from app.backtesting import backtest,simulate,entry_signals,validate_bars
from app.causal_signals import trend_features
from app.models import StockPriceHistory,Stock
from app.market_clock import latest_session
from app.freshness import stock_freshness


def bars(prices=None,n=180):
    prices=list(prices) if prices is not None else [100+i*.1 for i in range(n)]
    return [dict(date=date(2025,1,1)+timedelta(days=i),open_price=float(p),high_price=float(p)*1.01,
                 low_price=float(p)*.99,close_price=float(p),volume=1000) for i,p in enumerate(prices)]


class Engine(unittest.TestCase):
    def test_next_open_and_two_sided_costs_are_exact(self):
        data=bars([100]*100)
        signals=[i==89 for i in range(100)]
        r=simulate(data,signals,data[90]['date'],10000,10,5,2)
        expected=10000*(1-.0005)/(1+.0005)*(1-.001)/(1+.001)
        self.assertAlmostEqual(r['final_equity'],expected,places=5)
        self.assertEqual(r['trade_count'],1)
        self.assertGreater(r['trades'][0]['entry_date'],r['trades'][0]['signal_date'])
        self.assertEqual(r['trades'][0]['exit_date'],data[92]['date'])
        self.assertGreater(r['fees_paid'],0);self.assertGreater(r['slippage_cost'],0)

    def test_no_signals_means_no_fabricated_trades(self):
        data=bars()
        r=simulate(data,[False]*len(data),data[90]['date'],10000,10,5,10)
        self.assertEqual((r['final_equity'],r['trade_count'],r['win_rate_pct']),(10000,0,None))

    def test_last_signal_has_no_future_open(self):
        data=bars()
        signals=[False]*(len(data)-1)+[True]
        self.assertEqual(simulate(data,signals,data[90]['date'],10000,0,0,10)['trade_count'],0)

    def test_no_overlapping_positions_and_explicit_period_end(self):
        data=bars(n=100)
        r=simulate(data,[True]*100,data[90]['date'],10000,0,0,60)
        self.assertEqual(r['trade_count'],1)
        self.assertEqual(r['trades'][0]['exit_reason'],'period_end')

    def test_cost_drag_and_benchmark_use_same_window(self):
        prices=list(np.linspace(130,100,90))+list(np.linspace(100,150,90))
        data=bars(prices)
        r=backtest(data,'golden_cross',data[90]['date'],fee_bps=15,slippage_bps=5)
        self.assertGreater(r['trade_count'],0)
        self.assertGreater(r['cost_drag_pct'],0)
        self.assertLess(r['return_pct'],r['gross_return_pct'])
        self.assertGreater(r['benchmark_return_pct'],0)

    def test_invalid_ohlc_duplicate_dates_and_split_like_jump_rejected(self):
        for field,value in [('close_price',float('nan')),('open_price',0),('high_price',1)]:
            data=bars();data[10][field]=value
            with self.assertRaises(ValueError):validate_bars(data)
        data=bars();data[10]['date']=data[9]['date']
        with self.assertRaises(ValueError):validate_bars(data)
        with self.assertRaisesRegex(ValueError,'가격 단절'):validate_bars(bars([100]*100+[50]*80))
        validate_bars(bars([50]*180))  # The split-adjusted series is continuous.

    def test_pullback_is_dated_at_confirmation_not_the_earlier_dip(self):
        from app.technical_indicators import detect_pullback,generate_breakout_pullback_signals
        frame=pd.DataFrame({'close':[100,95,96],'open':[100,95,96],'high':[101,96,97],
                            'low':[99,94,95],'volume':[100,100,100]})
        self.assertIsNone(detect_pullback(frame.iloc[:2],0))
        self.assertEqual(detect_pullback(frame,0),2)
        data=bars(n=180)
        df=pd.DataFrame([dict(open=b['open_price'],high=b['high_price'],low=b['low_price'],close=b['close_price'],volume=b['volume']) for b in data])
        pd.testing.assert_frame_equal(generate_breakout_pullback_signals(df.iloc[:150]),generate_breakout_pullback_signals(df).iloc[:150])

    def test_warmup_is_not_filled_with_future_prices(self):
        data=bars()
        with self.assertRaisesRegex(ValueError,'90거래일'):backtest(data,'golden_cross',data[10]['date'])

    def test_future_rows_do_not_rewrite_historical_signals(self):
        rng=np.random.default_rng(37)
        data=bars(100+np.cumsum(rng.normal(0,.7,220)))
        for strategy in ('golden_cross','ma_breakout_up','descending_trendline_breakout'):
            self.assertEqual(entry_signals(data[:160],strategy),entry_signals(data,strategy)[:160])
        frame=pd.DataFrame([dict(date=b['date'],open=b['open_price'],high=b['high_price'],low=b['low_price'],close=b['close_price']) for b in data]).set_index('date')
        pd.testing.assert_frame_equal(trend_features(frame.iloc[:160]),trend_features(frame).iloc[:160])
        changed=frame.copy();changed.iloc[160:,changed.columns.get_loc('high')]=10000
        pd.testing.assert_frame_equal(trend_features(frame).iloc[:160],trend_features(changed).iloc[:160])


class QualityAPI(unittest.TestCase):
    setUpClass=classmethod(fixtures.Regressions.setUpClass.__func__)
    setUp=fixtures.Regressions.setUp
    tearDown=fixtures.Regressions.tearDown
    headers=fixtures.Regressions.headers

    def test_intraday_row_is_refreshed_even_when_date_matches(self):
        from app.crawlers.kis_history_crawler import KISHistoryCrawler
        expected,close=latest_session()
        self.stock.history_records_count=100
        self.db.add(StockPriceHistory(stock_id=self.stock.id,date=expected,close_price=100,updated_at=close-timedelta(hours=1)))
        self.db.commit()
        should,mode,last=KISHistoryCrawler()._should_collect_history(self.stock,self.db)
        self.assertTrue(should);self.assertEqual(mode,'incremental');self.assertEqual(last,expected-timedelta(days=1))
        row=self.db.query(StockPriceHistory).one();row.updated_at=close+timedelta(minutes=30);self.db.commit()
        self.assertEqual(KISHistoryCrawler()._should_collect_history(self.stock,self.db)[1],'skip')

    def test_unknown_or_old_timestamp_is_never_labelled_current(self):
        expected,_=latest_session()
        self.stock.history_completed_date=None
        self.assertEqual(stock_freshness(self.stock)['history_status'],'stale')
        self.stock.history_completed_date=expected
        self.stock.signal_as_of_date=expected
        self.stock.ma_signal_as_of_date=expected
        self.stock.signal_analyzed_at=self.stock.ma_signal_analyzed_at=datetime.utcnow()
        value=stock_freshness(self.stock)
        self.assertEqual(value['history_status'],'current')
        self.assertTrue(value['trend_current']);self.assertIsNone(value['quote_collected_at'])
        self.stock.history_precision_version=0
        self.assertEqual(stock_freshness(self.stock)['history_status'],'repair_required')

    def test_freshness_present_in_stock_search_and_tag_views(self):
        for path in ['/api/stocks','/api/stocks/search?q=TEST','/api/favorites']:
            response=self.client.get(path,headers=self.headers(self.user))
            self.assertEqual(response.status_code,200)
            if response.json()['stocks']:
                self.assertIn('freshness',response.json()['stocks'][0])
        response=self.client.get(f'/api/stocks/{self.stock.id}',headers=self.headers(self.user))
        self.assertIsNotNone(response.json()['freshness'])

    def test_manual_analysis_cannot_use_an_open_or_future_session(self):
        from app.signal_analyzer import SignalAnalyzer
        from app.ma_signal_analyzer import MASignalAnalyzer
        expected,_=latest_session()
        for i in range(100):
            self.db.add(StockPriceHistory(stock_id=self.stock.id,date=expected-timedelta(days=i),
                open_price=100,high_price=101,low_price=99,close_price=100,volume=100))
        self.db.add(StockPriceHistory(stock_id=self.stock.id,date=expected+timedelta(days=1),
            open_price=999,high_price=1000,low_price=998,close_price=999,volume=100))
        self.db.commit()
        for analyzer in (SignalAnalyzer(),MASignalAnalyzer()):
            with patch.object(analyzer,'_run_signal_analysis',return_value=[]) as compute:
                analyzer._analyze_stock(self.stock.id,180,self.db,end_date=expected+timedelta(days=10))
                self.assertTrue(all(row.date<=expected for row in compute.call_args.args[0]))
        self.db.refresh(self.stock)
        self.assertEqual(self.stock.signal_as_of_date,expected)
        self.assertEqual(self.stock.ma_signal_as_of_date,expected)

    def test_data_status_separates_collection_from_analysis(self):
        expected,_=latest_session()
        self.stock.history_completed_date=expected;self.db.commit()
        response=self.client.get('/api/data-status',headers=self.headers(self.user))
        us=next(m for m in response.json()['markets'] if m['market']=='US')
        self.assertEqual((us['current_history'],us['current_trend'],us['current_ma']),(1,0,0))

    def test_adjusted_request_does_not_change_raw_default(self):
        from app.kis.kis_client import KISClient
        client=object.__new__(KISClient);client.base_url='https://provider.example';client.client=MagicMock();client._get_headers=lambda _:{}
        client.client.get.return_value.json.return_value={'rt_cd':'0','output2':[]}
        client.get_us_stock_ohlcv('TEST');self.assertEqual(client.client.get.call_args.kwargs['params']['MODP'],'0')
        client.get_us_stock_ohlcv('TEST',adjusted=True);self.assertEqual(client.client.get.call_args.kwargs['params']['MODP'],'1')

    def test_backtest_auth_and_inputs(self):
        self.assertEqual(self.client.post('/api/backtests',json={'stock_id':self.stock.id}).status_code,401)
        for body in [{'stock_id':self.stock.id,'fee_bps':-1},{'stock_id':self.stock.id,'days':10000},
                     {'stock_id':self.stock.id,'end_date':(date.today()+timedelta(days=20)).isoformat()}]:
            self.assertEqual(self.client.post('/api/backtests',json=body,headers=self.headers(self.user)).status_code,422)

    def test_adjusted_fetch_failure_never_falls_back_to_raw_database(self):
        with patch('app.routers.research.rate_limit'),patch('app.crawlers.kis_history_crawler.kis_history_crawler.kis_client',object()), \
             patch('app.crawlers.kis_history_crawler.kis_history_crawler._collect_us_stock_history',side_effect=RuntimeError('provider unavailable')):
            response=self.client.post('/api/backtests',json={'stock_id':self.stock.id},headers=self.headers(self.user))
        self.assertEqual(response.status_code,502)

    def test_backtest_uses_closed_adjusted_data_without_mutating_raw(self):
        from app.market_clock import calendar
        end=latest_session()[0]
        dates=calendar().sessions_in_range(str(end-timedelta(days=600)),str(end))[-350:]
        data=[dict(date=d.date(),open_price=100+i*.1,high_price=101+i*.1,low_price=99+i*.1,close_price=100+i*.1,volume=100) for i,d in enumerate(dates)]
        with patch('app.routers.research.rate_limit'),patch('app.crawlers.kis_history_crawler.kis_history_crawler.kis_client',object()), \
             patch('app.crawlers.kis_history_crawler.kis_history_crawler._collect_us_stock_history',return_value=data) as fetch:
            response=self.client.post('/api/backtests',json={'stock_id':self.stock.id,'days':180},headers=self.headers(self.user))
        self.assertEqual(response.status_code,200,response.text)
        self.assertTrue(fetch.call_args.kwargs['adjusted'])
        self.assertEqual(response.json()['price_basis'],'provider_adjusted')
        self.assertEqual(self.db.query(StockPriceHistory).count(),0)
