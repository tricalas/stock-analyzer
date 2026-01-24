-- 성능 최적화를 위한 인덱스 추가
-- 실행: psql $DATABASE_URL -f add_indexes.sql

-- Stocks 테이블 인덱스
-- 1. 필터링에 자주 사용되는 컬럼들
CREATE INDEX IF NOT EXISTS idx_stocks_market ON stocks(market);
CREATE INDEX IF NOT EXISTS idx_stocks_exchange ON stocks(exchange);
CREATE INDEX IF NOT EXISTS idx_stocks_sector ON stocks(sector);
CREATE INDEX IF NOT EXISTS idx_stocks_is_active ON stocks(is_active);

-- 2. 정렬에 사용되는 컬럼
CREATE INDEX IF NOT EXISTS idx_stocks_market_cap ON stocks(market_cap DESC NULLS LAST);

-- 3. 복합 인덱스 (필터링 + 정렬 최적화)
-- is_active로 필터링하고 market으로 필터링한 후 market_cap으로 정렬
CREATE INDEX IF NOT EXISTS idx_stocks_active_market_cap
ON stocks(is_active, market, market_cap DESC NULLS LAST, id);

-- 4. 거래소별 조회 최적화
CREATE INDEX IF NOT EXISTS idx_stocks_active_exchange_cap
ON stocks(is_active, exchange, market_cap DESC NULLS LAST);

-- 5. 섹터별 조회 최적화
CREATE INDEX IF NOT EXISTS idx_stocks_active_sector_cap
ON stocks(is_active, sector, market_cap DESC NULLS LAST);

-- Stock Tag Assignments 테이블 인덱스 (이미 있을 수 있음)
-- 6. 태그 조회 최적화
CREATE INDEX IF NOT EXISTS idx_sta_stock_tag_user
ON stock_tag_assignments(stock_id, tag_id, user_token);

-- 7. 사용자별 태그 조회
CREATE INDEX IF NOT EXISTS idx_sta_user_tag
ON stock_tag_assignments(user_token, tag_id);

-- 8. 태그별 주식 조회 (get_stocks_by_tag 최적화)
CREATE INDEX IF NOT EXISTS idx_sta_tag_user_stock
ON stock_tag_assignments(tag_id, user_token, stock_id);

-- Stock Price History 테이블 인덱스 (이미 있을 수 있음)
-- 9. 주식 ID + 날짜 조회 최적화
CREATE INDEX IF NOT EXISTS idx_sph_stock_date
ON stock_price_history(stock_id, date DESC);

-- VACUUM ANALYZE로 통계 업데이트
VACUUM ANALYZE stocks;
VACUUM ANALYZE stock_tag_assignments;
VACUUM ANALYZE stock_price_history;

-- 생성된 인덱스 확인
SELECT
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE schemaname = 'public'
    AND tablename IN ('stocks', 'stock_tag_assignments', 'stock_price_history')
ORDER BY tablename, indexname;
