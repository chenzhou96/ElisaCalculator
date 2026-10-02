import test, {before, after, afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {readFile, mkdir, writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {spawn} from 'node:child_process'
import React from 'react'
import {JSDOM} from 'jsdom'
import {createServer} from 'vite'

// This is DOM integration, not a layout/browser test. Every parse and fit below
// is executed by the actual Python CLI; only the native/network transport is replaced.
const repo = fileURLToPath(new URL('../../', import.meta.url))
const comparison = JSON.parse(await readFile(new URL('../../examples/comparison_request.json', import.meta.url), 'utf8'))
const standard = JSON.parse(await readFile(new URL('../../examples/standard_request.json', import.meta.url), 'utf8'))
let server, Workbench, screen, render, fireEvent, within, waitFor, cleanup
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
  for (const key of ['window','document','HTMLElement','HTMLInputElement','Element','Node','MutationObserver','Event','MouseEvent','File','FileReader']) {
    Object.defineProperty(globalThis, key, {value: dom.window[key], configurable: true, writable: true})
  }
  Object.defineProperty(globalThis, 'navigator', {value: dom.window.navigator, configurable: true})
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  globalThis.fetch = async (url, init) => {
    assert.equal(url, '/api/bridge', 'No external network requests are allowed in this test')
    return new Response(JSON.stringify(await bridge(JSON.parse(init.body))), {status:200, headers:{'Content-Type':'application/json'}})
  }
  dom.window.addEventListener('error', event => runtimeErrors.push(event.message))
  ;({screen, render, fireEvent, within, waitFor, cleanup} = await import('@testing-library/react'))
  server = await createServer({server:{middlewareMode: true, hmr: false}, appType: 'custom'})
  Workbench = (await server.ssrLoadModule('/src/workbench/Workbench.tsx')).default
})
afterEach(() => {cleanup(); assert.deepEqual(runtimeErrors, [])})
after(async () => {
  await server?.close()
  await mkdir('artifacts/qa', {recursive:true})
  await writeFile('artifacts/qa/dom-scientific-calls.json', JSON.stringify(scientificCalls.map(({request,response}) => ({request, response:{...response,previews:response.previews?.map(({id,group_name,data_url})=>({id,group_name,png_bytes_base64:data_url.length}))}})), null, 2))
})
function click(name) {fireEvent.click(screen.getByRole('button', {name, exact:true}))}
function navigate(name) {fireEvent.click(within(screen.getByRole('navigation', {name:'分析导航'})).getByRole('button', {name:new RegExp(`^${name}`)}))}
function change(label,value) {fireEvent.change(screen.getByLabelText(label,{exact:true}),{target:{value}})}
async function parse(raw) {
  change('原始 ELISA 数据', raw)
  click('解析预览')
  await waitFor(()=>assert.ok(screen.getByRole('combobox',{name:'X 轴列',exact:true})),{timeout:30_000})
}
async function run() {
  const count = scientificCalls.length
  click('运行分析')
  await waitFor(()=>assert.ok(scientificCalls.length>count && scientificCalls.at(-1).request.command==='run'),{timeout:60_000})
  const body = scientificCalls.at(-1).response
  assert.equal(body.ok,true,body.error)
  await waitFor(()=>assert.ok(screen.getByRole('heading',{name:/曲线参数与比较|未知样品浓度/})),{timeout:30_000})
  return body
}

test('actual comparison CLI result renders 40X, creates plots with export disabled, and invalidates on settings change', async () => {
  render(React.createElement(Workbench))
  await parse(comparison.raw_text)
  navigate('分析设置')
  change('参考组','Reference')
  change('参考组赋值（X）','10')
  const body = await run()
  const sample = body.report.summary_rows.find(row=>row.Group==='Sample_4X')
  assert.ok(Math.abs(sample.Relative_stock_potency_X-40)<1e-4)
  assert.ok(screen.getByRole('cell',{name:'40 X',exact:true}))
  assert.equal(body.exports_skipped,true)
  assert.ok(body.previews.length>=3)
  navigate('曲线预览')
  assert.match(screen.getByRole('img',{name:/4PL 拟合曲线/}).getAttribute('src'), /^data:image\/png;base64,/)
  navigate('分析设置')
  change('参考组赋值（X）','1')
  navigate('结果汇总')
  assert.ok(screen.getByRole('heading',{name:'结果还未生成',exact:true}))
  navigate('曲线预览')
  assert.ok(screen.getByRole('heading',{name:'暂无曲线预览',exact:true}))
  navigate('分析设置')
  change('参考组赋值（X）','2.5')
  const scaled = await run()
  assert.ok(Math.abs(scaled.report.summary_rows.find(row=>row.Group==='Sample_4X').Relative_stock_potency_X-10)<1e-4)
  assert.ok(screen.getByRole('cell',{name:'10 X',exact:true}))
})

test('actual standard CLI result renders 12 ng/mL and corrected 60 ng/mL while guarding out-of-range OD', async () => {
  render(React.createElement(Workbench))
  click(/^标准曲线\s*未知样品浓度反算$/)
  await parse(standard.raw_text)
  navigate('分析设置')
  change('输入方式','raw_concentration')
  change('标准曲线','Standard')
  change('4PL 拟合模式','independent')
  navigate('未知样品')
  const [known,below] = standard.analysis_options.unknown_samples
  change('样品名称 1',known.sample_id)
  change('样品 OD 1',known.od.join('; '))
  change('样品稀释倍数 1',String(known.dilution_factor))
  click('＋ 添加样品')
  change('样品名称 2',below.sample_id)
  change('样品 OD 2',String(below.od))
  const body = await run()
  const row = body.report.unknown_results.find(row=>row.Sample===known.sample_id)
  assert.ok(Math.abs(row.Concentration-12)<1e-5)
  assert.ok(Math.abs(row.Corrected_concentration-60)<1e-4)
  const guarded = body.report.unknown_results.find(row=>row.Sample===below.sample_id)
  assert.equal(guarded.Concentration,null)
  assert.equal(guarded.Corrected_concentration,null)
  assert.equal(screen.getByText('下平台 A', {exact:true}).nextElementSibling.textContent, '0.08')
  assert.equal(screen.getByText('上平台 D', {exact:true}).nextElementSibling.textContent, '2.88')
  const renderedKnown = screen.getByRole('cell',{name:known.sample_id,exact:true}).closest('tr')
  assert.match(renderedKnown.textContent,/12ng\/mL/)
  assert.match(renderedKnown.textContent,/60ng\/mL/)
  const renderedGuarded = screen.getByRole('cell',{name:below.sample_id,exact:true}).closest('tr')
  assert.match(renderedGuarded.textContent,/—/)
})

test('example parsing, header override, invalid table and invalid option remain actionable', async () => {
  render(React.createElement(Workbench))
  click('载入示例')
  await parse(screen.getByLabelText('原始 ELISA 数据').value)
  assert.ok(screen.getByRole('cell',{name:'2.375',exact:true}))
  click('下一页')
  assert.ok(screen.getByText('6–8 / 8',{exact:true}))
  change('首行表头','absent')
  await parse('1,0.1,0.2\n2,0.3,0.4\n3,0.5,0.6\n4,0.7,0.8')
  assert.equal(scientificCalls.at(-1).response.row_count,4)
  change('原始 ELISA 数据','only_one_column\nnot_a_table')
  click('解析预览')
  await waitFor(()=>assert.match(screen.getByRole('alert').textContent,/列数不足/),{timeout:30_000})
  click('关闭错误')
  assert.equal(screen.queryByRole('alert'),null)
  await parse(comparison.raw_text)
  navigate('分析设置')
  change('参考组','Reference')
  change('每级稀释倍数','1')
  const count = scientificCalls.length
  click('运行分析')
  assert.match(screen.getByRole('alert').textContent,/2–10/)
  assert.equal(scientificCalls.length,count,'Invalid settings must not reach scientific computation')
})

test('file decoding, portable JSON restore, stale-file guard, menus and reset cancellation preserve user work', async () => {
  render(React.createElement(Workbench))
  const bytes = await readFile(new URL('../../examples/comparison_8_steps.csv', import.meta.url))
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  const dataInput = document.querySelector('input[type="file"][accept=".csv,.tsv,.txt"]')
  fireEvent.change(dataInput, {target:{files:[{name:'known-truth.csv', size:bytes.length, arrayBuffer:async()=>arrayBuffer}]}})
  await waitFor(()=>assert.equal(screen.getByLabelText('原始 ELISA 数据').value,comparison.raw_text))
  assert.ok(screen.getByText('known-truth.csv · utf-8',{exact:true}))
  click('解析预览')
  await waitFor(()=>assert.ok(screen.getByRole('combobox',{name:'X 轴列',exact:true})),{timeout:30_000})
  navigate('分析设置')
  change('参考组','Reference')
  change('参考组赋值（X）','10')
  await run()

  let savedBlob
  const create = URL.createObjectURL
  const revoke = URL.revokeObjectURL
  const anchorClick = window.HTMLAnchorElement.prototype.click
  URL.createObjectURL = blob=>{savedBlob=blob;return 'blob:local-test-download'}
  URL.revokeObjectURL = ()=>{}
  window.HTMLAnchorElement.prototype.click = ()=>{}
  try {
    click('保存记录')
    const saved = JSON.parse(await savedBlob.text())
    assert.equal(saved.schema,'elisa-analysis/1')
    assert.equal(saved.inputs.options.reference_assigned_value,10)
    assert.ok(Math.abs(saved.result.report.summary_rows.find(row=>row.Group==='Sample_4X').Relative_stock_potency_X-40)<1e-4)
    click('文件')
    fireEvent.click(screen.getByRole('menuitem',{name:'新建分析',exact:true}))
    assert.ok(screen.getByRole('dialog',{name:'新建分析？'}))
    click('取消')
    assert.equal(screen.queryByRole('dialog'),null)
    assert.ok(screen.getByRole('cell',{name:'40 X',exact:true}))
    navigate('原始数据')
    change('原始 ELISA 数据','changed after save')
    const recordInput = document.querySelector('input[type="file"][accept=".json"]')
    const jsonBytes = new TextEncoder().encode(JSON.stringify(saved))
    fireEvent.change(recordInput,{target:{files:[{name:'analysis.json',size:jsonBytes.length,arrayBuffer:async()=>jsonBytes.buffer}]}})
    await waitFor(()=>assert.equal(screen.getByLabelText('原始 ELISA 数据').value,comparison.raw_text))
    assert.equal(screen.getByRole('button',{name:'运行分析',exact:true}).disabled,true)
    navigate('结果汇总')
    assert.ok(screen.getByRole('heading',{name:'结果还未生成',exact:true}))
    navigate('原始数据')
    let release
    const delay = new Promise(resolve=>{release=resolve})
    fireEvent.change(recordInput,{target:{files:[{name:'delayed.json',size:jsonBytes.length,arrayBuffer:()=>delay}]}})
    change('原始 ELISA 数据','new edit while record is loading')
    release(jsonBytes.buffer)
    await waitFor(()=>assert.doesNotMatch(screen.getByRole('status').textContent,/更改输入会使/))
    assert.equal(screen.getByLabelText('原始 ELISA 数据').value,'new edit while record is loading')
    click('文件')
    fireEvent.keyDown(document,{key:'Escape'})
    assert.equal(screen.queryByRole('menu'),null)
  } finally {
    URL.createObjectURL=create
    URL.revokeObjectURL=revoke
    window.HTMLAnchorElement.prototype.click=anchorClick
  }
})
