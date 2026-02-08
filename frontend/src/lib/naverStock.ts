/**
 * 네이버 주식 URL 생성 유틸리티 (미국 주식 전용)
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
 */
export function getNaverSymbol(stock: StockInfo): string {
  if (stock.exchange === 'NASDAQ') {
    return `${stock.symbol}.O`;
  }
  return stock.symbol;
}

/**
 * 네이버 차트 URL 생성
 */
export function getNaverChartUrl(stock: StockInfo): string {
  const naverSymbol = getNaverSymbol(stock);
  return `https://m.stock.naver.com/fchart/foreign/stock/${naverSymbol}`;
}

/**
 * 네이버 종목 정보 URL 생성
 */
export function getNaverInfoUrl(stock: StockInfo): string {
  const naverSymbol = getNaverSymbol(stock);
  return `https://m.stock.naver.com/worldstock/stock/${naverSymbol}/total`;
}

/**
 * 네이버 차트를 70% 너비 팝업으로 열기
 */
export function openNaverChartPopup(stock: StockInfo): void {
  const url = getNaverChartUrl(stock);
  const width = Math.floor(window.screen.width * 0.7);
  const height = window.screen.height;
  const left = Math.floor(window.screen.width * 0.3);
  const top = 0;

  window.open(
    url,
    '_blank',
    `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
  );
}

/**
 * 네이버 차트를 새 탭으로 열기
 */
export function openNaverChartNewTab(stock: StockInfo): void {
  const url = getNaverChartUrl(stock);
  window.open(url, '_blank');
}
