import test, {before, after, afterEach} from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import {JSDOM} from 'jsdom'
import {createServer} from 'vite'

// Isolated editor integration: no network, transport mock, or synthetic engine result.
let server, PlatePanel, plateModule, model, screen, render, fireEvent, cleanup
let current, actions
before(async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {url:'http://127.0.0.1/'})
  for (const key of ['window','document','HTMLElement','HTMLInputElement','HTMLTextAreaElement','HTMLSelectElement','Element','Node','MutationObserver','Event','MouseEvent']) {
    Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true,writable:true})
  }
  Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true})
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  ;({screen,render,fireEvent,cleanup}=await import('@testing-library/react'))
  server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'})
  PlatePanel=(await server.ssrLoadModule('/src/workbench/PlatePanel.tsx')).default
  plateModule=await server.ssrLoadModule('/src/workbench/plate.ts')
  model=await server.ssrLoadModule('/src/workbench/model.ts')
})
afterEach(()=>cleanup())
after(async()=>{await server?.close()})
const assignment={kind:'comparison',group:'Reference',start:128,factor:2,direction:'decreasing',axis:'column',spacing:'physical',dilution:1}
const well=(id)=>current.plate.wells.find(w=>w.id===id)
function setup(plate,options={}) {
  actions=[]
  const initial={...structuredClone(model.initialWorkspace),plate,options:{...model.defaultOptions,reference_group:'Reference',...options},result:{ok:true},version:21}
  function Harness() {
    const [state,setState]=React.useState(initial)
    current=state
    function dispatch(action) {actions.push(action);setState(s=>model.reducer(s,action))}
    return React.createElement(PlatePanel,{state,dispatch,parse:()=>{throw new Error('Editor test must not compute')}})
  }
  render(React.createElement(Harness))
}
function choose(id,options={}) {fireEvent.click(document.querySelector(`[data-well="${id}"]`),options)}
function change(label,value) {fireEvent.change(screen.getByLabelText(label,{exact:true}),{target:{value}})}
function click(name) {fireEvent.click(screen.getByRole('button',{name,exact:true}))}
function apply() {click('应用到选中孔')}
function seeded() {
  let p=plateModule.assignWells(plateModule.createPlate(),plateModule.rectangleIds('A1','H2'),assignment)
  p=plateModule.assignWells(p,['C4','C6','C7','C8','C9','C10'],{...assignment,group:'Separate',start:10,factor:3,direction:'increasing',axis:'row',spacing:'compact'})
  return {...p,wells:p.wells.map(w=>w.kind==='comparison'?{...w,raw:'0.5'}:w)}
}

test('marked selection reads all saved settings and full original gradient without mutation',()=>{
  setup(seeded());const before=JSON.stringify(current.plate.wells)
  choose('C6')
  assert.equal(screen.getByLabelText('孔类型').value,'comparison')
  assert.equal(screen.getByLabelText('组名 / 样品名').value,'Separate')
  assert.equal(screen.getByLabelText('起始量 / 浓度').value,'10')
  assert.equal(screen.getByLabelText('梯度稀释倍数').value,'3')
  assert.equal(screen.getByLabelText('梯度板方向').value,'row')
  assert.equal(screen.getByLabelText('浓度方向').value,'increasing')
  assert.equal(screen.getByLabelText('跨空位处理').value,'compact')
  assert.match(document.querySelector('.gradient-preview').textContent,/C4=10.*C6=30（选中）/)
  assert.equal(JSON.stringify(current.plate.wells),before);assert.equal(current.version,21);assert.equal(current.platePast.length,0);assert.ok(current.result)
  assert.ok(actions.every(a=>a.type==='plate-selection'))
})
test('unassigned selection restores defaults after unsaved marked edits, including keyboard selection',()=>{
  setup(seeded());choose('C6');change('组名 / 样品名','Draft');change('起始量 / 浓度','999')
  choose('E3')
  for(const [label,value] of [['孔类型','comparison'],['组名 / 样品名','Reference'],['起始量 / 浓度','1'],['梯度稀释倍数','2'],['梯度板方向','column'],['浓度方向','decreasing'],['跨空位处理','physical']])assert.equal(screen.getByLabelText(label).value,value,label)
  assert.match(screen.getByRole('status',{name:''}).textContent,/未分配孔/)
  assert.equal(well('C6').group,'Separate');assert.equal(well('E3').kind,'unassigned');assert.equal(current.version,21)
  fireEvent.keyDown(document.querySelector('[data-well="E3"]'),{key:'ArrowRight'})
  assert.deepEqual(current.plate.selected,['E4']);assert.equal(screen.getByLabelText('起始量 / 浓度').value,'1')
})
test('mixed selection is blocked until deliberate uniform settings and Apply, Cancel, Undo and Redo are atomic',()=>{
  setup(seeded());choose('B1');choose('C6',{ctrlKey:true})
  assert.ok(screen.getByRole('button',{name:'应用到选中孔'}).disabled)
  assert.ok(screen.getByLabelText('孔类型').closest('fieldset').disabled)
  assert.match(document.querySelector('.plate-editor').textContent,/不一致.*不会读取第一个孔/)
  const original=JSON.stringify(current.plate.wells)
  click('统一设置这些孔');change('组名 / 样品名','Unified');change('起始量 / 浓度','64')
  assert.equal(JSON.stringify(current.plate.wells),original);assert.equal(current.version,21)
  apply();assert.ok(screen.getByRole('dialog',{name:'覆盖孔位标记？'}));click('取消覆盖')
  assert.equal(JSON.stringify(current.plate.wells),original);assert.equal(current.platePast.length,0)
  apply();click('确认覆盖孔位');assert.equal(well('B1').group,'Unified');assert.equal(well('C6').group,'Unified');assert.equal(well('A1').group,'Reference')
  assert.equal(current.platePast.length,1);assert.equal(current.result,null)
  const changed=JSON.stringify(current.plate.wells)
  click('撤销孔板操作');assert.equal(JSON.stringify(current.plate.wells),original)
  click('重做孔板操作');assert.equal(JSON.stringify(current.plate.wells),changed)
  const count=current.platePast.length;apply();assert.equal(current.platePast.length,count,'Repeated application must not create redundant edits')
})
test('arithmetic OD and assignment drafts are read-only until Apply; cancel discards both and undo restores',()=>{
  setup(seeded());choose('B1');const before=JSON.stringify(current.plate.wells)
  change('B1 原始 OD','=1/20');change('组名 / 样品名','Draft')
  assert.equal(well('B1').raw,'0.5');assert.equal(current.version,21);assert.equal(JSON.stringify(current.plate.wells),before)
  click('取消修改');assert.equal(screen.getByLabelText('B1 原始 OD').value,'0.5');assert.equal(screen.getByLabelText('组名 / 样品名').value,'Reference')
  change('B1 原始 OD','=1/20');fireEvent.blur(screen.getByLabelText('B1 原始 OD'))
  assert.equal(screen.getByLabelText('B1 原始 OD').value,'0.05');assert.equal(well('B1').raw,'0.5')
  apply();click('确认覆盖孔位');assert.equal(well('B1').raw,'0.05');assert.equal(well('B1').dose,64)
  click('撤销孔板操作');assert.equal(well('B1').raw,'0.5');assert.equal(screen.getByLabelText('B1 原始 OD').value,'0.5')
})
test('editing a middle well preserves true group origin for rename and gradient adjustment',()=>{
  setup(seeded());choose('D1')
  assert.equal(screen.getByLabelText('起始量 / 浓度').value,'128')
  assert.match(document.querySelector('.gradient-preview').textContent,/A1=128.*D1=16（选中）.*H2=1/)
  change('组名 / 样品名','Renamed');apply();click('确认覆盖孔位')
  assert.equal(well('D1').dose,16);assert.equal(well('A1').dose,128);assert.equal(well('D1').group,'Renamed')
  change('起始量 / 浓度','64');assert.match(document.querySelector('.gradient-preview').textContent,/D1=8（选中）/)
  click('取消修改')
  click('撤销孔板操作');change('起始量 / 浓度','64')
  assert.match(document.querySelector('.gradient-preview').textContent,/D1=8（选中）/)
  assert.equal(well('D1').dose,16);apply();click('确认覆盖孔位');assert.equal(well('D1').dose,8);assert.equal(well('A1').dose,128)
})
test('new entry choices are comparative-only and legacy records remain readable until explicit reassignment',()=>{
  setup(plateModule.plateExample('standard_curve'));const original=JSON.stringify(current.plate.wells)
  choose('A3')
  const type=screen.getByLabelText('孔类型')
  assert.equal(type.value,'unknown');assert.ok(type.querySelector('option[value="unknown"]').disabled)
  assert.equal(type.querySelector('option[value="standard"]'),null)
  assert.ok(screen.getByRole('button',{name:'应用到选中孔'}).disabled)
  assert.match(document.querySelector('.plate-board-card').textContent,/兼容性提示.*保留原类型/)
  assert.equal(JSON.stringify(current.plate.wells),original);assert.equal(well('A3').dilution,5)
  change('孔类型','comparison');apply();click('确认覆盖孔位')
  assert.equal(well('A3').kind,'comparison');assert.equal(well('A3').raw,JSON.parse(original).find(w=>w.id==='A3').raw)
  assert.equal(well('B3').kind,'unknown');assert.equal(well('B3').dilution,5)
  fireEvent.click(screen.getByRole('tab',{name:'分析约定',exact:true}))
  assert.equal(screen.queryByLabelText('板图标准曲线引用'),null);assert.equal(screen.queryByRole('checkbox',{name:/外推/}),null)
  assert.match(document.querySelector('.plate-analysis-controls').textContent,/中点倍率不证明恒定效价/)
})


test('focused numeric drafts reset on cancellation and cannot resurrect after selecting another well',()=>{
  setup(seeded());choose('B1')
  const start=screen.getByLabelText('起始量 / 浓度')
  fireEvent.focus(start);change('起始量 / 浓度','=128/4')
  assert.equal(well('B1').dose,64);click('取消修改')
  assert.equal(screen.getByLabelText('起始量 / 浓度').value,'128')
  fireEvent.focus(screen.getByLabelText('起始量 / 浓度'));change('起始量 / 浓度','64')
  choose('E3');assert.equal(screen.getByLabelText('起始量 / 浓度').value,'1')
  choose('B1');assert.equal(screen.getByLabelText('起始量 / 浓度').value,'128');assert.equal(current.version,21)
})


test('legacy plate explicitly switches workflow without converting or erasing wells or unknown metadata',()=>{
  const plate=plateModule.plateExample('standard_curve')
  const unknown_samples=[{sample_id:'Archived unknown',od:[0.5],dilution_factor:5}]
  setup(plate,{workflow:'standard_curve',standard_group:'Standard',unknown_samples})
  const original=JSON.stringify(current.plate.wells)
  fireEvent.click(screen.getByRole('tab',{name:'分析约定',exact:true}))
  click('将此板图改为比较分析')
  assert.equal(current.options.workflow,'comparative')
  assert.equal(JSON.stringify(current.plate.wells),original)
  assert.deepEqual(current.options.unknown_samples,unknown_samples)
  assert.equal(current.options.standard_group,'Standard')
  assert.equal(current.result,null)
  assert.ok(plateModule.compilePlate(current.plate,current.options).errors.some(error=>/旧版/.test(error)))
  click('撤销孔板操作')
  assert.equal(current.options.workflow,'standard_curve')
  assert.equal(JSON.stringify(current.plate.wells),original)
})
