import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../src/lib/naverStock.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const {getNaverSymbol,getNaverInfoUrl,getNaverChartUrl}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
test('Nasdaq detail links retain the Reuters exchange suffix',()=>{
 const s={symbol:'JD',market:'US',exchange:'NASDAQ'};
 assert.equal(getNaverInfoUrl(s),'https://m.stock.naver.com/worldstock/stock/JD.O/total');
 assert.equal(getNaverChartUrl(s),'https://m.stock.naver.com/fchart/foreign/stock/JD.O');
});
test('verified current Reuters code overrides an old ticker and exchange',()=>{
 const s={symbol:'TCBI',market:'US',exchange:'NASDAQ',naver_symbol:'TXCP.K'};
 assert.equal(getNaverInfoUrl(s),'https://m.stock.naver.com/worldstock/stock/TXCP.K/total');
 assert.equal(getNaverChartUrl(s),'https://m.stock.naver.com/fchart/foreign/stock/TXCP.K');
});
test('preferred shares retain Naver punctuation instead of internal display codes',()=>{
 assert.equal(getNaverSymbol({symbol:'ET PR I',market:'US',exchange:'NYSE',naver_symbol:'ET_pi'}),'ET_pi');
 assert.equal(getNaverSymbol({symbol:'TFIN PR',market:'US',exchange:'NYSE',naver_symbol:'TFIN_p.K'}),'TFIN_p.K');
});
test('NYSE tickers do not acquire a Nasdaq suffix',()=>{
 assert.equal(getNaverInfoUrl({symbol:'IBM',market:'US',exchange:'NYSE'}),'https://m.stock.naver.com/worldstock/stock/IBM/total');
});
test('an existing Nasdaq suffix is not added twice',()=>{
 assert.equal(getNaverSymbol({symbol:'SPCX.O',market:'US',exchange:'NASDAQ'}),'SPCX.O');
});
test('domestic stocks use domestic info and chart routes',()=>{
 const s={symbol:'005930',market:'KR',exchange:'KOSPI'};
 assert.equal(getNaverInfoUrl(s),'https://m.stock.naver.com/domestic/stock/005930/total');
 assert.equal(getNaverChartUrl(s),'https://m.stock.naver.com/fchart/domestic/stock/005930');
});
