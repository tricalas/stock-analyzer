import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../src/lib/signal-feed.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const {signalFeedPath,signalLabel,ma90Distance}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
test('all filters and pagination reach the selected category endpoint',()=>{
 const url=new URL(signalFeedPath({category:'trendline',strategy:'doji_star',search:'  애플 & AAPL  ',days:30,sort:'return_desc',returnFilter:'flat'},60),'https://example.com');
 assert.equal(url.pathname,'/api/signals');assert.equal(url.searchParams.get('search'),'애플 & AAPL');
 for(const [k,v] of Object.entries({strategy:'doji_star',days:'30',sort:'return_desc',return_filter:'flat',skip:'60',limit:'30'}))assert.equal(url.searchParams.get(k),v);
});
test('MA requests preserve category and omit the all sentinel',()=>{
 const url=new URL(signalFeedPath({category:'ma',strategy:'all',search:'',days:10,sort:'latest',returnFilter:'all'}),'https://example.com');
 assert.equal(url.pathname,'/api/signals/ma');assert.equal(url.searchParams.has('strategy'),false);
});
test('signal labels identify actual MA periods and doji',()=>{
 assert.equal(signalLabel({strategy_name:'ma_support',ma_period:90}),'MA90 지지');
 assert.equal(signalLabel({strategy_name:'golden_cross',ma_period:0}),'MA20/60 골든크로스');
 assert.equal(signalLabel({strategy_name:'doji_star',ma_period:0}),'도지 패턴');
});
test('MA90 distances support both response shapes and reject bad data',()=>{
 assert.equal(ma90Distance({sma_90_ratio:103.5}),3.5);assert.equal(ma90Distance('{"sma_90_ratio":98}'),-2);
 for(const v of [null,'{bad}',{}, {sma_90_ratio:0},{sma_90_ratio:'103'},{sma_90_ratio:Infinity}])assert.equal(ma90Distance(v),null);
});
