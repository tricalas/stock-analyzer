/**
 * 네이버 주식 URL 생성 유틸리티
 */

interface StockInfo {
  symbol: string;
  market: string;
  exchange?: string;
}

/**
 * 네이버 증권용 심볼 생성
 * - NASDAQ 종목은 .O 접미사 추가
 * - NYSE 종목은 그대로
 * - 국내 종목은 그대로
 */
export function getNaverSymbol(stock: StockInfo): string {
  if (stock.market === 'US' && stock.exchange === 'NASDAQ') {
    return `${stock.symbol}.O`;
  }
  return stock.symbol;
}

/**
 * 네이버 차트 URL 생성
 */
export function getNaverChartUrl(stock: StockInfo): string {
  const naverSymbol = getNaverSymbol(stock);

  if (stock.market === 'US') {
    return `https://m.stock.naver.com/fchart/foreign/stock/${naverSymbol}`;
  }
  return `https://m.stock.naver.com/fchart/domestic/stock/${naverSymbol}`;
}

/**
 * 네이버 종목 정보 URL 생성
 */
export function getNaverInfoUrl(stock: StockInfo): string {
  const naverSymbol = getNaverSymbol(stock);

  if (stock.market === 'US') {
    return `https://m.stock.naver.com/worldstock/stock/${naverSymbol}/total`;
  }
  return `https://m.stock.naver.com/domestic/stock/${naverSymbol}/total`;
}
