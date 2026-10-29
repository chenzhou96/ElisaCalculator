import test,{before,after,afterEach} from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import {JSDOM} from 'jsdom'
import {createServer} from 'vite'
// Rendering fixtures test presentation/null handling only; numerical truth uses the real-engine suites.
let server,ResultsPanel,model,screen,render,cleanup
before(async()=>{
 const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://127.0.0.1/'})
 for(const key of ['window','document','HTMLElement','Element','Node','MutationObserver'])Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true,writable:true})
 Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true})
 globalThis.IS_REACT_ACT_ENVIRONMENT=true
 ;({screen,render,cleanup}=await import('@testing-library/react'))
 server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'})
 ResultsPanel=(await server.ssrLoadModule('/src/workbench/ResultsPanel.tsx')).default
 model=await server.ssrLoadModule('/src/workbench/model.ts')
})
afterEach(()=>cleanup());after(async()=>{await server?.close()})
const row={Group:'Sample',N:8,EC50:.25,EC50_unit:'dimensionless dose',EC50_ratio:.25,Normalized_midpoint_X:40,Normalized_midpoint_X_CI_low:38,Normalized_midpoint_X_CI_high:42,Relative_stock_potency_X:null,Slope:1.8,Global_A:.08,Global_D:2.88,R2:1,RMSE:0,Status:'Success',Warning:''}
function show(rows,options={},pending=false){const state={...structuredClone(model.initialWorkspace),result:{ok:true,report:{options:{dose_basis:'dimensionless',...options},summary_rows:rows,unknown_results:[],metadata:{}}}};render(React.createElement(ResultsPanel,{state,dispatch:()=>{},selected:'Sample',onSelect:()=>{},normalizationPending:pending}));return screen.getByRole('table',{name:'各组相对参比结果'})}
test('primary summary pairs normalized X with direct reference midpoint ratio and its conditional CI',()=>{
 const table=show([row]);assert.match(table.textContent,/40 X中点比值 4 倍于参比/);assert.match(table.textContent,/38 – 42/)
 assert.ok(screen.getByRole('button',{name:'Sample',exact:true}));assert.match(screen.getByText(/未证明曲线平行或恒定生物效价/).textContent,/条件置信区间/)
 assert.equal(document.querySelector('.metric-grid'),null)
})
test('absolute-dose mode never manufactures stock X and labels EC50 CI units',()=>{
 const table=show([{...row,Normalized_midpoint_X:null,Normalized_midpoint_X_CI_low:null,Normalized_midpoint_X_CI_high:null,EC50_CI_low:.2,EC50_CI_high:.3,EC50_unit:'ng/mL'}],{dose_basis:'stock_fraction',input_mode:'raw_concentration'})
 assert.match(table.textContent,/本组 \/ 参比/);assert.doesNotMatch(table.textContent,/40 X|参比归一 X|倍于参比/);assert.match(table.textContent,/.25 ng\/mL/);assert.match(table.textContent,/0.2 – 0.3/)
})
test('eligible historical stock fractions retain their scientific X and stock CI at the top',()=>{
 const table=show([{...row,Normalized_midpoint_X:null,Relative_stock_potency_X:40,Relative_stock_potency_X_CI_low:35,Relative_stock_potency_X_CI_high:45}],{dose_basis:'stock_fraction',input_mode:'dilution_step'})
 assert.match(table.textContent,/40 X/);assert.match(table.textContent,/35 – 45/)
})
test('failures, missing comparison and pending normalization cannot display stale or fabricated numbers',()=>{
 const table=show([{...row,Status:'Failed',Warning:'unidentifiable reference',Normalized_midpoint_X:40},{...row,Group:'Suppressed',Normalized_midpoint_X:null,Warning:'opposite response directions suppress comparison'}])
 assert.doesNotMatch(table.textContent,/40 X/);assert.match(table.textContent,/拟合失败.*不提供倍数/);assert.match(table.textContent,/不可比较/)
 assert.equal(table.querySelector('details').open,true,'Suppression reason must be expanded, not hidden behind a generic status')
 cleanup();const pending=show([row],{},true);assert.match(pending.textContent,/更新中/);assert.doesNotMatch(pending.textContent,/40 X|38 – 42/)
})
