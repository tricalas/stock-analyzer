import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../src/lib/freshness.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const { freshnessLabel,sessionLabel }=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
test('session labels preserve the exchange date without timezone conversion',()=>{
 assert.equal(sessionLabel('2026-11-06'),'11/06');assert.equal(sessionLabel(null),'미확인');
});
test('freshness never calls stale or unknown data current',()=>{
 assert.equal(freshnessLabel(undefined),'기준일 미확인');
 assert.equal(freshnessLabel({history_status:'stale'}),'확정 일봉 지연');
 assert.equal(freshnessLabel({history_status:'repair_required'}),'가격 복구 필요');
 assert.equal(freshnessLabel({history_status:'current',trend_current:false,ma_current:false}),'분석 갱신 필요');
 assert.equal(freshnessLabel({history_status:'current',trend_current:true,ma_current:true}),'최신 확정·분석');
});
test('insufficient MA history is distinct from an analysis delay',()=>{
 assert.equal(freshnessLabel({history_status:'current',ma_status:'insufficient_history'}),'확정 일봉 최신 · MA 자료 부족');
});
