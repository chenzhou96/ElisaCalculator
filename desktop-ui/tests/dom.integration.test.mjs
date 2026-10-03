import test, {before, beforeEach, after, afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {readFile, mkdir, writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {spawn} from 'node:child_process'
import React from 'react'
import {JSDOM} from 'jsdom'
import {IDBFactory} from 'fake-indexeddb'
import {createServer} from 'vite'

// The actual React UI and Python CLI are used. jsdom substitutes the browser
// DOM and fake-indexeddb substitutes IndexedDB storage, never scientific results.
const repo = fileURLToPath(new URL('../../', import.meta.url))
const standard = JSON.parse(await readFile(new URL('../../examples/standard_request.json', import.meta.url), 'utf8'))
let server, Workbench, model, plate, history, screen, render, fireEvent, within, waitFor, cleanup, act
let transportGate = null
let bridgeInFlight = 0
const scientificCalls = []
const runtimeErrors = []
function bridge(payload) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.ELISA_PYTHON || 'python', ['-m', 'elisa_calculator.bridge'], {cwd: repo, env: {...process.env, MPLCONFIGDIR: '/tmp/elisa-dom-matplotlib', XDG_CACHE_HOME: '/tmp/elisa-dom-cache'}, stdio: ['pipe','pipe','pipe']})
    let stdout = '', stderr = ''
    child.stdout.on('data', chunk => {stdout += chunk})
    child.stderr.on('data', chunk => {stderr += chunk})
    child.on('error', reject)
    child.on('close', code => {
      if (code) return reject(new Error(stderr || `Python exit ${code}`))
      try {const response = JSON.parse(stdout); scientificCalls.push({request: payload, response}); resolve(response)} catch (error) {reject(error)}
    })
    child.stdin.end(JSON.stringify(payload))
  })
}
before(async () => {
  process.env.VITE_ELISA_DEV_BRIDGE = '1'
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {url: 'http://127.0.0.1:1420/'})
  for (const key of ['window','document','HTMLElement','HTMLInputElement','HTMLTextAreaElement','HTMLSelectElement','Element','Node','MutationObserver','Event','MouseEvent','KeyboardEvent','File','FileReader']) {
    Object.defineProperty(globalThis, key, {value: dom.window[key], configurable: true, writable: true})
  }
  Object.defineProperty(globalThis, 'navigator', {value: dom.window.navigator, configurable: true})
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  globalThis.fetch = async (url, init) => {
    assert.equal(url, '/api/bridge', 'No external network requests are allowed in this test')
    const request = JSON.parse(init.body)
    bridgeInFlight++
    try {
      const response = await bridge(request)
      if (transportGate && request.command === transportGate.command) await transportGate.hold(response)
      return new Response(JSON.stringify(response), {status:200, headers:{'Content-Type':'application/json'}})
    } finally {bridgeInFlight--}
  }
  dom.window.addEventListener('error', event => runtimeErrors.push(event.message))
  ;({screen, render, fireEvent, within, waitFor, cleanup, act} = await import('@testing-library/react'))
  server = await createServer({server:{middlewareMode: true, hmr: false}, appType: 'custom'})
  Workbench = (await server.ssrLoadModule('/src/workbench/Workbench.tsx')).default
  model = await server.ssrLoadModule('/src/workbench/model.ts')
  plate = await server.ssrLoadModule('/src/workbench/plate.ts')
  history = (await server.ssrLoadModule('/src/workbench/history.ts')).defaultHistoryService
})
beforeEach(() => {
  const indexedDB = new IDBFactory()
  Object.defineProperty(globalThis, 'indexedDB', {value:indexedDB, configurable:true, writable:true})
  Object.defineProperty(window, 'indexedDB', {value:indexedDB, configurable:true, writable:true})
  window.localStorage.clear()
  transportGate = null
})
afterEach(() => {cleanup(); transportGate = null; assert.deepEqual(runtimeErrors, [])})
after(async () => {
  await server?.close()
  await mkdir('artifacts/qa', {recursive:true})
  await writeFile('artifacts/qa/dom-scientific-calls.json', JSON.stringify(scientificCalls.map(({request,response}) => ({request:request.command === 'renormalize' ? {...request, run_response:{ok:request.run_response.ok, report:request.run_response.report}} : request, response:{...response,previews:response.previews?.map(({id,group_name,data_url})=>({id,group_name,png_bytes_base64:data_url.length}))}})), null, 2))
})
function click(name) {fireEvent.click(screen.getByRole('button', {name, exact:true}))}
function navigate(name) {fireEvent.click(within(screen.getByRole('navigation', {name:'分析导航'})).getByRole('button', {name:new RegExp(`^${name}`)}))}
function tab(name) {fireEvent.click(screen.getByRole('tab', {name, exact:true}))}
function change(label,value) {fireEvent.change(screen.getByLabelText(label,{exact:true}),{target:{value}})}
const well = id => document.querySelector(`[data-well="${id}"]`)
const status = () => document.querySelector('.status-bar').textContent
async function mount() {
  render(React.createElement(Workbench))
  await waitFor(() => assert.match(status(), /已自动保存到本机/))
}
async function run() {
  const count = scientificCalls.length
  click('运行分析')
  await waitFor(()=>assert.ok(scientificCalls.length>count && scientificCalls.at(-1).request.command==='run'),{timeout:60_000})
  const body = scientificCalls.at(-1).response
  assert.equal(body.ok,true,body.error)
  await waitFor(()=>assert.ok(screen.queryByRole('heading',{name:'曲线参数与比较', exact:true})),{timeout:30_000})
  return body
}
async function parseMapping() {
  click('检查孔位映射')
  const count = scientificCalls.length
  click('确认映射并解析')
  await waitFor(() => assert.ok(scientificCalls.length > count && scientificCalls.at(-1).request.command === 'parse'), {timeout:30_000})
  assert.equal(scientificCalls.at(-1).response.ok, true)
  await waitFor(() => assert.doesNotMatch(status(), /更改输入会使/))
}
function apply() {
  click('应用到选中孔')
  if (screen.queryByRole('dialog', {name:'覆盖孔位标记？', exact:true})) click('确认覆盖孔位')
}
function formula(label,text,expected) {
  const input=screen.getByLabelText(label,{exact:true})
  fireEvent.focus(input); fireEvent.change(input,{target:{value:text}}); fireEvent.blur(input)
  assert.equal(input.value,expected,label)
}
async function importRecord(record, name='analysis.json') {
  const bytes = new TextEncoder().encode(typeof record === 'string' ? record : JSON.stringify(record))
  fireEvent.change(document.querySelector('input[type="file"][accept=".json"]'),{target:{files:[{name,size:bytes.length,arrayBuffer:async()=>bytes.buffer}]}})
  await waitFor(() => assert.doesNotMatch(status(), /更改输入会使/))
}
async function savedRecord() {
  let savedBlob
  const create=URL.createObjectURL, revoke=URL.revokeObjectURL, anchor=window.HTMLAnchorElement.prototype.click
  URL.createObjectURL=blob=>{savedBlob=blob;return 'blob:local-test-download'}
  URL.revokeObjectURL=()=>{}
  window.HTMLAnchorElement.prototype.click=()=>{}
  try {click('保存记录'); assert.ok(savedBlob); return JSON.parse(await savedBlob.text())}
  finally {URL.createObjectURL=create;URL.revokeObjectURL=revoke;window.HTMLAnchorElement.prototype.click=anchor}
}
async function rawSession(value) {
  const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('elisa-analysis-history',1);request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('session'))request.result.createObjectStore('session');if(!request.result.objectStoreNames.contains('snapshots'))request.result.createObjectStore('snapshots',{keyPath:'id'})};request.onerror=()=>reject(request.error);request.onsuccess=()=>resolve(request.result)})
  try{return await new Promise((resolve,reject)=>{const tx=db.transaction('session',value===undefined?'readonly':'readwrite'),store=tx.objectStore('session');let result;const request=value===undefined?store.get('last'):store.put(value,'last');request.onsuccess=()=>{result=request.result};tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(tx.error);tx.onerror=()=>reject(tx.error)})}finally{db.close()}
}
async function settleAutosave(){await act(async()=>{await new Promise(resolve=>setTimeout(resolve,350))})}
function successfulRows(response) {return response.report.summary_rows.filter(row => row.Status === 'Success')}
function fitOnly(response) {return {details:response.report.detailed_rows.map(({warning_list,...details})=>details), globals:response.report.global_params, previews:response.previews, summary:response.report.summary_rows.map(({Group,N,EC50,LogEC50,Slope,A,D,Global_A,Global_D,R2,RMSE,Status})=>({Group,N,EC50,LogEC50,Slope,A,D,Global_A,Global_D,R2,RMSE,Status}))}}

 test('new workspace exposes only the plate comparative workflow and its four permitted well types', async () => {
  await mount()
  assert.equal(screen.getAllByRole('gridcell').length,96)
  assert.deepEqual(within(screen.getByRole('navigation',{name:'分析导航'})).getAllByRole('button').map(button=>button.textContent.replace(/0\d$/, '').trim()),['原始数据','结果汇总','曲线预览'])
  assert.equal(screen.queryByRole('tab',{name:'表格输入',exact:true}),null)
  assert.equal(screen.queryByRole('button',{name:/标准曲线.*未知样品/}),null)
  assert.deepEqual([...screen.getByLabelText('孔类型').options].map(option=>option.value),['comparison','blank','excluded','unassigned'])
  tab('分析约定')
  assert.equal(screen.queryByLabelText('标准曲线'),null)
  assert.equal(screen.queryByLabelText('样品 OD 1'),null)
 })

 test('actual direct plate run gives reference 10X/sample 40X; result renormalization gives sample 7X/reference 1.75X without fitting', async () => {
  await mount(); click('载入板示例')
  assert.equal(screen.queryByRole('dialog'), null)
  assert.equal(well('A3').querySelector('.well-group').textContent,'Sample_4X')
  assert.match(well('A3').querySelector('.well-label').textContent,/剂量 1/)
  assert.equal(document.querySelectorAll('.group-swatch').length,2)
  const count=scientificCalls.length, body=await run()
  assert.deepEqual(scientificCalls.slice(count).map(call=>call.request.command),['run'])
  assert.equal(body.exports_skipped,true)
  assert.ok(body.previews.length>=3)
  assert.equal(body.report.metadata.plate_mapping.rows.length,96)
  assert.equal(successfulRows(body).length,2)
  assert.ok(Math.abs(body.report.summary_rows.find(row=>row.Group==='Sample_4X').Normalized_midpoint_X-40)<1e-4)
  assert.ok(screen.getByRole('cell',{name:'40 X',exact:true}))
  const invariant=fitOnly(body)
  change('结果参比组','Sample_4X')
  formula('结果参比赋值（X）','=14/2','7')
  await waitFor(()=>assert.ok(screen.queryByRole('cell',{name:'1.75 X',exact:true})),{timeout:60_000})
  assert.ok(screen.getByRole('cell',{name:'7 X',exact:true}))
  await waitFor(()=>assert.equal(bridgeInFlight,0),{timeout:60_000})
  const normalized=scientificCalls.findLast(call=>call.request.command==='renormalize'&&call.request.reference_group==='Sample_4X'&&call.request.reference_assigned_value===7)
  assert.ok(normalized)
  assert.equal(normalized.request.command,'renormalize')
  assert.equal(normalized.request.reference_group,'Sample_4X')
  assert.equal(normalized.request.reference_assigned_value,7)
  assert.equal(scientificCalls.slice(count).filter(call=>call.request.command==='run').length,1)
  assert.deepEqual(fitOnly(normalized.response),invariant)
  const countAfter=scientificCalls.length
  click('切换到夜间模式'); assert.equal(document.documentElement.dataset.theme,'dark')
  navigate('原始数据'); fireEvent.click(well('B2')); fireEvent.click(well('G4'),{ctrlKey:true})
  navigate('结果汇总'); fireEvent.click(screen.getByRole('cell',{name:/^Sample_4X(?:\s*REF)?$/}))
  assert.ok(screen.getByRole('cell',{name:'1.75 X',exact:true}))
  assert.equal(scientificCalls.length,countAfter,'Theme, well selection, and result selection must not recompute or invalidate results')
  navigate('曲线预览')
  assert.equal(screen.getByRole('img',{name:/4PL 拟合曲线/}).getAttribute('src'),body.previews[0].data_url)
 })

 test('plate draft edits, arithmetic and cancel do not write; confirmed OD and model edits invalidate result and previews',async()=>{
  await mount();click('载入板示例');await run()
  const count=scientificCalls.length
  navigate('原始数据');fireEvent.click(well('A1'))
  const original=well('A1').getAttribute('aria-label')
  formula('起始量 / 浓度','=1/20','0.05');formula('梯度稀释倍数','=(3+1)/2','2');formula('A1 原始 OD','=4/2','2')
  assert.equal(well('A1').getAttribute('aria-label'),original)
  click('取消修改');assert.equal(screen.getByLabelText('起始量 / 浓度').value,'1')
  navigate('结果汇总');assert.ok(screen.getByRole('cell',{name:'40 X',exact:true}))
  navigate('原始数据');fireEvent.click(well('A1'));formula('A1 原始 OD','=4/2','2');apply()
  assert.match(well('A1').getAttribute('aria-label'),/OD 2 /)
  navigate('结果汇总');assert.ok(screen.getByRole('heading',{name:'结果还未生成',exact:true}))
  navigate('曲线预览');assert.ok(screen.getByRole('heading',{name:'暂无曲线预览',exact:true}))
  assert.equal(scientificCalls.length,count)
  navigate('原始数据');click('撤销孔板操作');await run()
  navigate('原始数据');tab('分析约定');change('板图4PL拟合模式','independent')
  navigate('结果汇总');assert.ok(screen.getByRole('heading',{name:'结果还未生成',exact:true}))
  navigate('曲线预览');assert.ok(screen.getByRole('heading',{name:'暂无曲线预览',exact:true}))
 })

 test('plate validation routes missing reference and invalid OD to the actual editor, selects the bad well, and permits correction',async()=>{
  await mount();click('载入板示例');tab('分析约定');change('板图参比组','')
  const count=scientificCalls.length
  navigate('结果汇总');click('运行分析')
  await waitFor(()=>assert.equal(screen.getByLabelText('板图参比组').getAttribute('aria-invalid'),'true'))
  assert.equal(document.activeElement,screen.getByLabelText('板图参比组'))
  change('板图参比组','Reference');assert.ok(screen.getByLabelText('板图参比组'))
  tab('标记选中孔');fireEvent.click(well('B2'));change('B2 原始 OD','bad OD');apply()
  navigate('结果汇总');click('运行分析')
  await waitFor(()=>assert.equal(screen.getByLabelText('B2 原始 OD').getAttribute('aria-invalid'),'true'))
  assert.equal(well('B2').getAttribute('aria-invalid'),'true')
  assert.equal(well('B2').closest('[role="gridcell"]').getAttribute('aria-selected'),'true')
  assert.equal(scientificCalls.length,count,'Validation errors cannot reach Python')
  formula('B2 原始 OD','=2.5265680393449*2/2','2.5265680393449');apply();await run()
 })

 test('real mapping parse stays optional; arithmetic errors remain editable and invalid gradients cannot be committed',async()=>{
  await mount();click('载入板示例');await parseMapping()
  const count=scientificCalls.length
  fireEvent.click(well('A1'))
  const input=screen.getByLabelText('A1 原始 OD')
  fireEvent.focus(input);fireEvent.change(input,{target:{value:'=1/0'}});fireEvent.blur(input)
  assert.equal(input.value,'=1/0');assert.equal(input.getAttribute('aria-invalid'),'true')
  assert.ok(screen.getByText('不能除以 0'))
  formula('A1 原始 OD','=4/2','2')
  fireEvent.click(well('A2'));assert.notEqual(screen.getByLabelText('A2 原始 OD').value,'=1/0')
  formula('梯度稀释倍数','=2/2','1')
  assert.equal(screen.getByRole('button',{name:'应用到选中孔',exact:true}).disabled,true)
  formula('梯度稀释倍数','=8/4','2')
  assert.equal(screen.getByRole('button',{name:'应用到选中孔',exact:true}).disabled,false)
  tab('分析约定');formula('板图参比赋值（X）','=20/2','10')
  const body=await run();assert.ok(Math.abs(body.report.summary_rows.find(row=>row.Group==='Sample_4X').Normalized_midpoint_X-40)<1e-4)
  assert.equal(scientificCalls.slice(count).filter(call=>call.request.command==='parse').length,0)
 })

 test('plate file decoding and explicit paste preserve coordinates, zero, missing cells, invalid text, undo and redo',async()=>{
  await mount()
  const rows=Array.from({length:8},(_,r)=>Array.from({length:12},(_,c)=>String((r+1)*100+c+1)))
  rows[0][0]='0';rows[2][4]='';rows[7][11]=''
  const bytes=new TextEncoder().encode('\ufeff'+rows.map(row=>row.join('\t')).join('\n'))
  fireEvent.change(screen.getByLabelText('导入板读数文件'),{target:{files:[{name:'coordinates.tsv',size:bytes.length,arrayBuffer:async()=>bytes.buffer}]}})
  await waitFor(()=>assert.ok(screen.getByRole('dialog',{name:'粘贴读数预览',exact:true})))
  assert.equal(well('A1').querySelector('strong').textContent,'—','File import must wait for explicit paste confirmation')
  click('确认导入读数')
  assert.equal(well('A1').querySelector('strong').textContent,'0');assert.equal(well('H1').querySelector('strong').textContent,'801')
  assert.equal(well('A12').querySelector('strong').textContent,'112');assert.equal(well('H12').querySelector('strong').textContent,'—')
  assert.equal(well('C5').querySelector('strong').textContent,'—')
  click('粘贴读数');change('Excel 孔板读数','1\t2\n3')
  assert.equal(screen.getByRole('button',{name:'确认导入读数',exact:true}).disabled,true)
  click('取消粘贴');assert.equal(well('H1').querySelector('strong').textContent,'801')
  click('粘贴读数');change('Excel 孔板读数','bad\t0')
  assert.equal(screen.getByRole('button',{name:'确认导入读数',exact:true}).disabled,true)
  fireEvent.click(screen.getByLabelText(/保留非法文本及其坐标/));fireEvent.click(screen.getByLabelText(/确认覆盖现有读数/));click('确认导入读数')
  assert.equal(well('A1').querySelector('strong').textContent,'!');assert.equal(well('A2').querySelector('strong').textContent,'0')
  click('撤销孔板操作');assert.equal(well('A1').querySelector('strong').textContent,'0');assert.equal(well('A2').querySelector('strong').textContent,'102')
  click('重做孔板操作');assert.equal(well('A1').querySelector('strong').textContent,'!')
 })

 test('seven dose points with same-group eighth-row blanks preserve actual 40X comparison and missing-scope errors block parsing',async()=>{
  await mount();click('载入板示例');fireEvent.click(well('H1'))
  click('粘贴读数');change('Excel 孔板读数','.02\t.02\t.02\t.02');fireEvent.click(screen.getByLabelText(/确认覆盖现有读数/));click('确认导入读数')
  for(const [first,last,group]of [['H1','H2','Reference'],['H3','H4','Sample_4X']]){
    fireEvent.click(well(first));fireEvent.click(well(last),{shiftKey:true});change('孔类型','blank');change('空白作用组（同组模式必填）',group);apply()
  }
  tab('分析约定');change('空白校正作用域','group');await parseMapping()
  const body=await run()
  assert.equal(body.report.summary_rows.find(row=>row.Group==='Reference').N,14)
  assert.equal(body.report.summary_rows.find(row=>row.Group==='Sample_4X').N,14)
  assert.ok(Math.abs(body.report.summary_rows.find(row=>row.Group==='Sample_4X').Normalized_midpoint_X-40)<1e-4)
  assert.equal(body.report.metadata.plate_mapping.rows.find(row=>row.well==='H1').tableColumn,null)
  assert.equal(screen.getByText('下平台 A',{exact:true}).nextElementSibling.textContent,'0.08')
  assert.equal(screen.getByText('上平台 D',{exact:true}).nextElementSibling.textContent,'2.88')
  navigate('原始数据');fireEvent.click(well('H1'));fireEvent.click(well('H2'),{shiftKey:true});change('空白作用组（同组模式必填）','Other');apply()
  const count=scientificCalls.length;click('检查孔位映射')
  assert.match(screen.getByRole('dialog',{name:'孔位组别浓度映射检查',exact:true}).textContent,/Reference：没有同组空白，不会回退到全板空白/)
  assert.equal(screen.getByRole('button',{name:'确认映射并解析',exact:true}).disabled,true)
  assert.equal(scientificCalls.length,count)
  click('返回板图');click('撤销孔板操作');await parseMapping()
 })

 test('v2 portable record recalls the complete actual fit and plots without running; invalid and stale imports preserve current work',async()=>{
  await mount();click('载入板示例');const body=await run(),saved=await savedRecord()
  assert.equal(saved.schema,'elisa-analysis/2');assert.equal(saved.inputs.inputView,'plate');assert.equal(saved.inputs.plate.wells.length,96)
  assert.equal(saved.inputs.options.reference_assigned_value,10);assert.deepEqual(saved.result,body)
  click('文件');fireEvent.click(screen.getByRole('menuitem',{name:'新建分析',exact:true}));assert.ok(screen.getByRole('dialog',{name:'新建分析？'}));click('取消')
  assert.ok(screen.getByRole('cell',{name:'40 X',exact:true}))
  navigate('原始数据');fireEvent.click(well('A1'));change('A1 原始 OD','0');apply()
  const count=scientificCalls.length;await importRecord(saved);navigate('原始数据')
  assert.match(well('A1').getAttribute('aria-label'),/2\.781493605490578/)
  navigate('结果汇总');assert.ok(screen.getByRole('cell',{name:'40 X',exact:true}));assert.match(status(),/历史/)
  navigate('曲线预览');assert.equal(screen.getByRole('img',{name:/4PL 拟合曲线/}).getAttribute('src'),body.previews[0].data_url)
  assert.equal(scientificCalls.length,count,'A complete record is restored without parse or fit')
  await importRecord({...saved,result:{...saved.result,report:{...saved.result.report,summary_rows:[{...saved.result.report.summary_rows[0],EC50:'fabricated'}]}}})
  assert.match(document.querySelector('#input-error').textContent,/有限数值/)
  assert.equal(screen.getByRole('img',{name:/4PL 拟合曲线/}).getAttribute('src'),body.previews[0].data_url)
  click('关闭错误');navigate('原始数据');fireEvent.click(well('A1'))
  let release
  const delay=new Promise(resolve=>{release=resolve}), bytes=new TextEncoder().encode(JSON.stringify(saved))
  fireEvent.change(document.querySelector('input[type="file"][accept=".json"]'),{target:{files:[{name:'delayed.json',size:bytes.length,arrayBuffer:()=>delay}]}})
  change('A1 原始 OD','0');apply();release(bytes.buffer)
  await waitFor(()=>assert.doesNotMatch(status(),/更改输入会使/))
  assert.match(well('A1').getAttribute('aria-label'),/OD 0 /)
  navigate('结果汇总');assert.ok(screen.getByRole('heading',{name:'结果还未生成',exact:true}))
  click('文件');fireEvent.keyDown(document,{key:'Escape'});assert.equal(screen.queryByRole('menu'),null)
 })

 test('legacy v1 table/standard data and settings stay read-only, with no fabricated historical results or automatic conversion',async()=>{
  await mount()
  // The legacy result comes from the actual standard engine. v1 cannot certify
  // a full snapshot, so the restored UI must retain inputs and omit this result.
  const body=await bridge(standard)
  const known=body.report.unknown_results.find(row=>row.Sample==='Known_truth_12')
  assert.ok(Math.abs(known.Concentration-12)<1e-5);assert.ok(Math.abs(known.Corrected_concentration-60)<1e-4)
  assert.equal(body.report.unknown_results.find(row=>row.Sample==='Below_range').Concentration,null)
  const legacy={schema:'elisa-analysis/1',inputs:{...model.initialWorkspace,inputView:'table',rawText:standard.raw_text,source:'legacy-standard.csv',options:{...model.defaultOptions,...standard.analysis_options,unknown_samples:standard.analysis_options.unknown_samples.map(row=>({...row,od:Array.isArray(row.od)?row.od:[row.od]}))},unknowns:standard.analysis_options.unknown_samples.map(row=>({sample:row.sample_id,od:(Array.isArray(row.od)?row.od:[row.od]).join('; '),dilution:String(row.dilution_factor)}))},result:body}
  await importRecord(legacy)
  assert.equal(screen.getByLabelText('保留的旧版输入').textContent,standard.raw_text)
  assert.match(document.querySelector('.notice.warning').textContent,/v1.*仅恢复输入/)
  assert.equal(screen.queryByLabelText('原始 ELISA 数据'),null)
  assert.equal(screen.queryByLabelText('样品 OD 1'),null)
  const count=scientificCalls.length;click('运行分析')
  assert.match(document.querySelector('#input-error').textContent,/仅供历史查看/);assert.equal(scientificCalls.length,count)
  navigate('结果汇总');assert.ok(screen.getByRole('heading',{name:'结果还未生成',exact:true}))
  const preserved=await savedRecord();assert.equal(preserved.result,null);assert.equal(preserved.inputs.rawText,legacy.inputs.rawText)
  assert.equal(preserved.inputs.options.workflow,'standard_curve');assert.deepEqual(preserved.inputs.unknowns.map(({sample,od,dilution})=>({sample,od,dilution})),legacy.inputs.unknowns)
  legacy.inputs.inputView='plate';legacy.inputs.plate=plate.plateExample('standard_curve')
  await importRecord(legacy);navigate('原始数据');fireEvent.click(well('A1'))
  assert.match(well('A1').getAttribute('aria-label'),/标准曲线 Standard/)
  assert.match(well('A3').getAttribute('aria-label'),/未知样品 Known_truth_12/)
  assert.equal(screen.getByLabelText('孔类型').value,'standard')
  assert.equal(screen.getByLabelText('孔类型').selectedOptions[0].disabled,true)
  assert.equal(screen.getByRole('button',{name:'应用到选中孔',exact:true}).disabled,true)
  click('运行分析');assert.equal(scientificCalls.length,count)
  assert.match(well('A1').getAttribute('aria-label'),/标准曲线 Standard/)
 })

 test('IndexedDB autosave survives remount and history recalls complete fit snapshots without scientific calls',async()=>{
  await mount();click('载入板示例');const body=await run()
  await waitFor(async()=>assert.ok((await history.list()).some(entry=>entry.hasResult)),{timeout:10_000})
  cleanup();render(React.createElement(Workbench))
  await waitFor(()=>assert.ok(screen.queryByRole('cell',{name:'40 X',exact:true})))
  navigate('原始数据');assert.match(well('A1').getAttribute('aria-label'),/2\.781493605490578/)
  navigate('结果汇总');await waitFor(()=>assert.ok(screen.queryByRole('cell',{name:'40 X',exact:true})),{timeout:10000,interval:200})
  navigate('原始数据');fireEvent.click(well('A1'));change('A1 原始 OD','0');apply()
  const count=scientificCalls.length
  click('分析历史');await waitFor(()=>assert.ok(screen.getByRole('dialog',{name:'分析历史',exact:true})))
  const snapshot=within(screen.getByRole('dialog',{name:'分析历史',exact:true})).getAllByRole('button').find(button=>button.textContent.includes('计算结果快照'))
  assert.ok(snapshot);fireEvent.click(snapshot)
  await waitFor(()=>assert.ok(!screen.queryByRole('dialog',{name:'分析历史',exact:true})))
  navigate('结果汇总');assert.ok(screen.getByRole('cell',{name:'40 X',exact:true}));assert.match(status(),/历史/)
  navigate('曲线预览');assert.equal(screen.getByRole('img',{name:/4PL 拟合曲线/}).getAttribute('src'),body.previews[0].data_url)
  assert.equal(scientificCalls.length,count)
 })

 test('failed startup recovery preserves original durable bytes until explicitly confirmed replacement',async()=>{
  const original=JSON.stringify({schema:'elisa-analysis/2',saved_at:new Date().toISOString(),inputs:{...model.initialWorkspace,inputView:'unsupported-legacy-view',rawText:'valuable unconvertible original input',options:model.defaultOptions},result:null,parsed:null})
  await rawSession(original);render(React.createElement(Workbench))
  await waitFor(()=>assert.match(document.querySelector('.notice.error')?.textContent??'',/自动恢复失败/))
  await settleAutosave();assert.equal(await rawSession(),original)
  click('载入板示例');await settleAutosave();assert.equal(await rawSession(),original)
  click('重试恢复');assert.ok(screen.getByRole('dialog',{name:'重试恢复上次会话？',exact:true}));click('取消恢复操作')
  click('替换旧恢复记录…');assert.ok(screen.getByRole('dialog',{name:'替换旧恢复记录？',exact:true}));click('取消恢复操作')
  await settleAutosave();assert.equal(await rawSession(),original)
  click('替换旧恢复记录…');click('确认替换旧恢复记录')
  await waitFor(()=>assert.match(status(),/已自动保存到本机/))
  const saved=JSON.parse(await rawSession());assert.equal(saved.inputs.inputView,'plate');assert.equal(saved.inputs.plate.wells[0].group,'Reference')
  const count=scientificCalls.length;cleanup();render(React.createElement(Workbench))
  await waitFor(()=>assert.ok(well('A1')?.getAttribute('aria-label').includes('Reference')))
  assert.equal(scientificCalls.length,count)
 })

 test('failed IndexedDB autosave keeps completed fits visible and retry succeeds without computation',async()=>{
  await mount();click('载入板示例')
  const factory=globalThis.indexedDB
  Object.defineProperty(globalThis,'indexedDB',{value:{open(){throw new Error('simulated quota/storage failure')}},configurable:true,writable:true})
  try{
    const body=await run()
    await waitFor(()=>assert.match(document.querySelector('.notice.error')?.textContent??'',/自动保存失败/))
    assert.ok(screen.getByRole('cell',{name:'40 X',exact:true}))
    assert.equal((await savedRecord()).result.report.summary_rows.length,body.report.summary_rows.length)
    const count=scientificCalls.length
    Object.defineProperty(globalThis,'indexedDB',{value:factory,configurable:true,writable:true})
    click('重试自动保存');await waitFor(()=>assert.ok(!document.querySelector('.notice.error')))
    assert.ok((await history.list()).some(entry=>entry.hasResult));assert.equal(scientificCalls.length,count)
  }finally{Object.defineProperty(globalThis,'indexedDB',{value:factory,configurable:true,writable:true})}
 })

 test('a delayed real run cannot restore a result after confirmed exclusion and undo',async()=>{
  await mount();click('载入板示例')
  let release,observed
  const held=new Promise(resolve=>{release=resolve}),seen=new Promise(resolve=>{observed=resolve})
  transportGate={command:'run',hold:async()=>{observed();await held}}
  click('运行分析');await seen
  fireEvent.click(well('A1'));change('孔类型','excluded');apply();assert.match(well('A1').getAttribute('aria-label'),/排除/)
  click('撤销孔板操作');assert.match(well('A1').getAttribute('aria-label'),/比较曲线 Reference/)
  release();await waitFor(()=>assert.ok(!screen.queryByRole('button',{name:'正在计算…',exact:true})))
  navigate('结果汇总');assert.ok(screen.getByRole('heading',{name:'结果还未生成',exact:true}))
  navigate('曲线预览');assert.ok(screen.getByRole('heading',{name:'暂无曲线预览',exact:true}))
 })

 test('night mode persists across remounts and the View menu switches back to light',async()=>{
  await mount();click('切换到夜间模式');assert.equal(document.documentElement.dataset.theme,'dark')
  cleanup();render(React.createElement(Workbench))
  assert.ok(screen.getByRole('button',{name:'切换到日间模式',exact:true}));assert.equal(document.documentElement.dataset.theme,'dark')
  click('视图');const item=screen.getByRole('menuitemcheckbox',{name:/夜间模式/})
  assert.equal(item.getAttribute('aria-checked'),'true');fireEvent.click(item)
  assert.equal(document.documentElement.dataset.theme,'light');assert.ok(screen.getByRole('button',{name:'切换到夜间模式',exact:true}))
 })
