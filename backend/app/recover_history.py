"""Repair fractional price history, then rebuild both signal strategies."""
import logging
from app.crawlers.kis_history_crawler import kis_history_crawler
from app.ma_signal_analyzer import ma_signal_analyzer
from app.signal_analyzer import signal_analyzer


def recover_history():
    if kis_history_crawler.kis_client is None:
        raise RuntimeError('KIS credentials are required for price history recovery')
    result = kis_history_crawler.collect_history_for_all_stocks(days=180, max_workers=1)
    if result.get('success') is False or result.get('failed_count', 0):
        raise RuntimeError(f'History recovery incomplete: {result}')
    signal_analyzer.analyze_and_store_signals(mode='all', days=180, force_full=True)
    ma_signal_analyzer.analyze_and_store_signals(mode='all', days=180, force_full=True)
    return result


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)
    print(recover_history())
