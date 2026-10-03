import {test, expect} from '@playwright/test'
import {readFile} from 'node:fs/promises'

const standard = JSON.parse(await readFile(new URL('../../examples/standard_request.json', import.meta.url), 'utf8'))
const well = (page,id) => page.locator(`[data-well="${id}"]`)
function bridgeResponse(page,command) {
  return page.waitForResponse(response => response.url().endsWith('/api/bridge') && response.request().postDataJSON()?.command === command)
}
async function nav(page,name) {await page.getByRole('navigation',{name:'分析导航'}).getByRole('button',{name:new RegExp(`^${name}`)}).click()}
async function run(page) {
  const response=bridgeResponse(page,'run')
  await page.getByRole('button',{name:'运行分析',exact:true}).click()
  const body=await(await response).json()
  expect(body.ok,body.error).toBe(true)
  await expect(page.getByRole('heading',{name:'曲线参数与比较',exact:true})).toBeVisible()
  return body
}
async function example(page) {await page.getByRole('button',{name:'载入板示例',exact:true}).click()}
async function apply(page) {
  await page.getByRole('button',{name:'应用到选中孔',exact:true}).click()
  const confirm=page.getByRole('button',{name:'确认覆盖孔位',exact:true})
  if(await confirm.count()) await confirm.click()
}
async function save(page,info,name='saved-analysis.json') {
  const event=page.waitForEvent('download')
  await page.getByRole('button',{name:'保存记录',exact:true}).click()
  const file=info.outputPath(name)
  await(await event).saveAs(file)
  return {file,record:JSON.parse(await readFile(file,'utf8'))}
}
async function restore(page,file) {
  await page.getByRole('button',{name:'文件',exact:true}).click()
  const chooser=page.waitForEvent('filechooser')
  await page.getByRole('menuitem',{name:'恢复分析记录…',exact:true}).click()
  await(await chooser).setFiles(file)
  await expect(page.getByRole('button',{name:'运行分析',exact:true})).toBeEnabled()
}
function fitOnly(response) {
  return {details:response.report.detailed_rows.map(({warning_list,...details})=>details),globals:response.report.global_params,previews:response.previews,summary:response.report.summary_rows.map(({Group,N,EC50,LogEC50,Slope,A,D,Global_A,Global_D,R2,RMSE,Status})=>({Group,N,EC50,LogEC50,Slope,A,D,Global_A,Global_D,R2,RMSE,Status}))}
}
async function screenshot(page,info,name) {
  await page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))})
  const geometry=await page.evaluate(()=>({viewport:[innerWidth,innerHeight],document:[document.documentElement.scrollWidth,document.documentElement.scrollHeight],scrollBoxes:[...document.querySelectorAll('.results-layout,.table-scroll,.plate-editor-body,.history-list,.reference-controls')].map(box=>({className:box.className,width:box.clientWidth,scrollWidth:box.scrollWidth})),wells:[...document.querySelectorAll('[data-well]')].map(well=>{const r=well.getBoundingClientRect();return {id:well.dataset.well,left:r.left,top:r.top,right:r.right,bottom:r.bottom}})}))
  expect(geometry.document[0],`${name}: horizontal page overflow`).toBeLessThanOrEqual(geometry.viewport[0]+1)
  expect(geometry.document[1],`${name}: compact workspace must fit the viewport`).toBeLessThanOrEqual(geometry.viewport[1]+1)
  for(const box of geometry.scrollBoxes) expect(box.scrollWidth,`${name}: ${box.className} must not need horizontal scrolling`).toBeLessThanOrEqual(box.width+1)
  for(const box of geometry.wells) {
    expect(box.left,box.id).toBeGreaterThanOrEqual(0);expect(box.top,box.id).toBeGreaterThanOrEqual(0)
    expect(box.right,box.id).toBeLessThanOrEqual(geometry.viewport[0]+1);expect(box.bottom,box.id).toBeLessThanOrEqual(geometry.viewport[1]+1)
  }
  await page.screenshot({path:info.outputPath(`${name}.png`),fullPage:false,animations:'disabled'})
  await info.attach(`${name}-geometry`,{body:JSON.stringify(geometry),contentType:'application/json'})
}

test.beforeEach(async({page})=>{
  page.__errors=[];page.__commands=[]
  page.on('pageerror',error=>page.__errors.push(error.message))
  page.on('console',message=>{if(message.type()==='error')page.__errors.push(message.text())})
  page.on('request',request=>{if(request.url().endsWith('/api/bridge'))page.__commands.push(request.postDataJSON()?.command)})
  await page.goto('/')
  await expect(page.getByRole('grid',{name:'96 孔板',exact:true})).toBeVisible()
  await expect(page.locator('.status-bar')).toContainText('已自动保存到本机')
})
test.afterEach(async({page},info)=>{
  await info.attach('browser-console-errors',{body:JSON.stringify(page.__errors),contentType:'application/json'})
  await info.attach('bridge-commands',{body:JSON.stringify(page.__commands),contentType:'application/json'})
  expect(page.__errors,'No runtime or console errors').toEqual([])
})

test('plate-only comparison uses the real engine and result reference edits renormalize without fitting',async({page},info)=>{
  await expect(page.getByRole('tab',{name:'表格输入',exact:true})).toHaveCount(0)
  await expect(page.getByRole('navigation',{name:'分析导航'}).getByRole('button')).toHaveCount(3)
  await expect(page.getByRole('navigation',{name:'分析导航'}).getByRole('button',{name:/分析设置|未知样品/})).toHaveCount(0)
  await expect(page.getByLabel('孔类型').locator('option')).toHaveCount(4)
  await expect(page.getByLabel('孔类型').locator('option[value="standard"],option[value="unknown"]')).toHaveCount(0)
  await example(page)
  const body=await run(page)
  expect(page.__commands).toEqual(['run'])
  expect(body.exports_skipped).toBe(true);expect(body.previews.length).toBeGreaterThanOrEqual(3)
  expect(body.report.summary_rows.find(row=>row.Group==='Reference').Normalized_midpoint_X).toBeCloseTo(10,4)
  expect(body.report.summary_rows.find(row=>row.Group==='Sample_4X').Normalized_midpoint_X).toBeCloseTo(40,4)
  await expect(page.getByRole('cell',{name:'40 X',exact:true})).toBeVisible()
  await screenshot(page,info,'plate-results-1366x768')
  await page.getByRole('combobox',{name:'结果参比组',exact:true}).selectOption('Sample_4X')
  const response=page.waitForResponse(response=>response.url().endsWith('/api/bridge')&&response.request().postDataJSON()?.command==='renormalize'&&response.request().postDataJSON()?.reference_assigned_value===7)
  await page.getByLabel('结果参比赋值（X）',{exact:true}).fill('=14/2')
  await page.getByLabel('结果参比赋值（X）',{exact:true}).press('Tab')
  const normalized=await(await response).json()
  expect(normalized.ok,normalized.error).toBe(true)
  await expect(page.getByRole('cell',{name:'1.75 X',exact:true})).toBeVisible()
  await expect(page.getByRole('cell',{name:'7 X',exact:true})).toBeVisible()
  expect(page.__commands.filter(command=>command==='run')).toHaveLength(1)
  expect(fitOnly(normalized)).toEqual(fitOnly(body))
  const count=page.__commands.length
  await page.getByRole('button',{name:'切换到夜间模式',exact:true}).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark')
  await screenshot(page,info,'plate-results-night-1366x768')
  await nav(page,'原始数据');await well(page,'B2').click();await well(page,'G4').click({modifiers:['Control']})
  await nav(page,'结果汇总');await page.getByRole('cell',{name:/^Sample_4X(?:\s*REF)?$/}).click()
  await expect(page.getByRole('cell',{name:'1.75 X',exact:true})).toBeVisible()
  expect(page.__commands).toHaveLength(count)
  await nav(page,'曲线预览')
  const image=page.getByRole('img',{name:/4PL 拟合曲线/})
  await expect(image).toBeVisible();expect(await image.getAttribute('src')).toBe(body.previews[0].data_url)
  expect(await image.evaluate(element=>element.complete&&element.naturalWidth>0)).toBe(true)
  await screenshot(page,info,'plate-plots-1366x768')
})

test('confirmed plate and model edits clear results and plots, while arithmetic drafts and cancellation preserve them',async({page})=>{
  await example(page);await run(page)
  await nav(page,'原始数据');await well(page,'A1').click()
  const original=await well(page,'A1').getAttribute('aria-label')
  await page.getByLabel('起始量 / 浓度',{exact:true}).fill('=1/20');await page.getByLabel('起始量 / 浓度',{exact:true}).press('Tab')
  await expect(page.getByLabel('起始量 / 浓度',{exact:true})).toHaveValue('0.05')
  await page.getByLabel('A1 原始 OD',{exact:true}).fill('=4/2');await page.getByLabel('A1 原始 OD',{exact:true}).press('Tab')
  await expect(well(page,'A1')).toHaveAttribute('aria-label',original)
  await page.getByRole('button',{name:'取消修改',exact:true}).click()
  await expect(page.getByLabel('起始量 / 浓度',{exact:true})).toHaveValue('1')
  await nav(page,'结果汇总');await expect(page.getByRole('cell',{name:'40 X',exact:true})).toBeVisible()
  await nav(page,'原始数据');await well(page,'A1').click();await page.getByLabel('A1 原始 OD',{exact:true}).fill('0');await apply(page)
  await nav(page,'结果汇总');await expect(page.getByRole('heading',{name:'结果还未生成',exact:true})).toBeVisible()
  await nav(page,'曲线预览');await expect(page.getByRole('heading',{name:'暂无曲线预览',exact:true})).toBeVisible()
  await nav(page,'原始数据');await page.getByRole('button',{name:'撤销孔板操作',exact:true}).click();await run(page)
  await nav(page,'原始数据');await page.getByRole('tab',{name:'分析约定',exact:true}).click()
  await page.getByLabel('板图4PL拟合模式',{exact:true}).selectOption('independent')
  await nav(page,'结果汇总');await expect(page.getByRole('heading',{name:'结果还未生成',exact:true})).toBeVisible()
  await nav(page,'曲线预览');await expect(page.getByRole('heading',{name:'暂无曲线预览',exact:true})).toBeVisible()
  expect(page.__commands.filter(command=>command==='run')).toHaveLength(2)
})

test('missing reference and invalid committed OD reveal and focus the relevant controls before any fit',async({page})=>{
  await example(page);await page.getByRole('tab',{name:'分析约定',exact:true}).click()
  await page.getByLabel('板图参比组',{exact:true}).selectOption('')
  await nav(page,'结果汇总');await page.getByRole('button',{name:'运行分析',exact:true}).click()
  await expect(page.getByLabel('板图参比组',{exact:true})).toHaveAttribute('aria-invalid','true')
  await expect(page.getByLabel('板图参比组',{exact:true})).toBeFocused()
  await page.getByLabel('板图参比组',{exact:true}).selectOption('Reference')
  await page.getByRole('tab',{name:'标记选中孔',exact:true}).click();await well(page,'B2').click()
  await page.getByLabel('B2 原始 OD',{exact:true}).fill('bad OD');await apply(page)
  await nav(page,'结果汇总');await page.getByRole('button',{name:'运行分析',exact:true}).click()
  await expect(page.getByLabel('B2 原始 OD',{exact:true})).toHaveAttribute('aria-invalid','true')
  await expect(well(page,'B2')).toHaveAttribute('aria-invalid','true')
  await expect(well(page,'B2').locator('..')).toHaveAttribute('aria-selected','true')
  expect(page.__commands).toEqual([])
  await page.getByLabel('B2 原始 OD',{exact:true}).fill('=2.5265680393449*2/2');await page.getByLabel('B2 原始 OD',{exact:true}).press('Tab');await apply(page)
  await run(page)
})

test('v2 portable snapshot restores actual fits and plots without scientific calls; reset cancellation retains work',async({page},info)=>{
  await example(page);const body=await run(page),{file,record}=await save(page,info)
  expect(record.schema).toBe('elisa-analysis/2');expect(record.inputs.inputView).toBe('plate')
  expect(record.inputs.plate.wells).toHaveLength(96);expect(record.result).toEqual(body)
  await page.getByRole('button',{name:'文件',exact:true}).click();await page.getByRole('menuitem',{name:'新建分析',exact:true}).click()
  await expect(page.getByRole('dialog',{name:'新建分析？',exact:true})).toBeVisible()
  await page.getByRole('button',{name:'取消',exact:true}).click();await expect(page.getByRole('cell',{name:'40 X',exact:true})).toBeVisible()
  await nav(page,'原始数据');await well(page,'A1').click();await page.getByLabel('A1 原始 OD',{exact:true}).fill('0');await apply(page)
  const count=page.__commands.length;await restore(page,file);await nav(page,'原始数据')
  await expect(well(page,'A1')).toHaveAttribute('aria-label',/2\.781493605490578/)
  await nav(page,'结果汇总');await expect(page.getByRole('cell',{name:'40 X',exact:true})).toBeVisible()
  await expect(page.getByText(/历史结果快照/)).toBeVisible()
  await nav(page,'曲线预览');await expect(page.getByRole('img',{name:/4PL 拟合曲线/})).toHaveAttribute('src',body.previews[0].data_url)
  expect(page.__commands).toHaveLength(count)
  await page.getByRole('button',{name:'文件',exact:true}).click();await page.keyboard.press('Escape');await expect(page.getByRole('menu')).toHaveCount(0)
  await screenshot(page,info,'portable-history-plots-1366x768')
})

test('IndexedDB session survives reload and history restores an unchanged result snapshot without fitting',async({page},info)=>{
  await example(page);const body=await run(page)
  await expect.poll(async()=>page.evaluate(()=>new Promise((resolve,reject)=>{const open=indexedDB.open('elisa-analysis-history',1);open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,tx=db.transaction('snapshots','readonly'),request=tx.objectStore('snapshots').getAll();request.onsuccess=()=>resolve(request.result.filter(item=>item.entry?.hasResult).length);tx.oncomplete=()=>db.close()}}))).toBeGreaterThan(0)
  const count=page.__commands.length;await page.reload();await expect(page.getByRole('cell',{name:'40 X',exact:true})).toBeVisible();await nav(page,'原始数据');await expect(well(page,'A1')).toHaveAttribute('aria-label',/2\.781493605490578/)
  await nav(page,'结果汇总');await expect(page.getByRole('cell',{name:'40 X',exact:true})).toBeVisible()
  await nav(page,'原始数据');await well(page,'A1').click();await page.getByLabel('A1 原始 OD',{exact:true}).fill('0');await apply(page)
  await page.getByRole('button',{name:'分析历史',exact:true}).click()
  const dialog=page.getByRole('dialog',{name:'分析历史',exact:true})
  await expect(dialog).toBeVisible();await screenshot(page,info,'analysis-history-1366x768')
  await dialog.getByRole('button').filter({hasText:'计算结果快照'}).first().click()
  await expect(dialog).toHaveCount(0);await nav(page,'结果汇总');await expect(page.getByRole('cell',{name:'40 X',exact:true})).toBeVisible()
  await nav(page,'曲线预览');await expect(page.getByRole('img',{name:/4PL 拟合曲线/})).toHaveAttribute('src',body.previews[0].data_url)
  expect(page.__commands).toHaveLength(count)
})

test('legacy v1 standard table retains every input as read-only and cannot invent historical numeric results',async({page},info)=>{
  const response=await page.request.post('/api/bridge',{data:standard}),body=await response.json()
  expect(body.ok,body.error).toBe(true)
  expect(body.report.unknown_results.find(row=>row.Sample==='Known_truth_12').Corrected_concentration).toBeCloseTo(60,4)
  expect(body.report.unknown_results.find(row=>row.Sample==='Below_range').Concentration).toBeNull()
  const unknowns=standard.analysis_options.unknown_samples.map(row=>({sample:row.sample_id,od:(Array.isArray(row.od)?row.od:[row.od]).join('; '),dilution:String(row.dilution_factor)}))
  const record={schema:'elisa-analysis/1',inputs:{inputView:'table',rawText:standard.raw_text,source:'legacy-standard.csv',headerMode:'present',xColumn:'concentration_ng_ml',options:{...standard.analysis_options,unknown_samples:standard.analysis_options.unknown_samples.map(row=>({...row,od:Array.isArray(row.od)?row.od:[row.od]}))},unknowns,saveOutputs:false},result:body}
  await page.getByRole('button',{name:'文件',exact:true}).click();const chooser=page.waitForEvent('filechooser');await page.getByRole('menuitem',{name:'恢复分析记录…',exact:true}).click()
  await(await chooser).setFiles({name:'legacy-standard.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(record))})
  await expect(page.getByLabel('保留的旧版输入',{exact:true})).toHaveText(standard.raw_text.trim())
  await expect(page.getByText(/旧版 v1 记录仅恢复输入/)).toBeVisible()
  await expect(page.getByLabel('原始 ELISA 数据',{exact:true})).toHaveCount(0);await expect(page.getByLabel('样品 OD 1',{exact:true})).toHaveCount(0)
  const count=page.__commands.length;await page.getByRole('button',{name:'运行分析',exact:true}).click();await expect(page.locator('#input-error')).toContainText('仅供历史查看')
  await nav(page,'结果汇总');await expect(page.getByRole('heading',{name:'结果还未生成',exact:true})).toBeVisible()
  const saved=await save(page,info,'preserved-legacy.json')
  expect(saved.record.result).toBeNull();expect(saved.record.inputs.rawText).toBe(standard.raw_text)
  expect(saved.record.inputs.options.workflow).toBe('standard_curve');expect(saved.record.inputs.unknowns.map(({sample,od,dilution})=>({sample,od,dilution}))).toEqual(unknowns)
  expect(page.__commands).toHaveLength(count)
})

test('persistent export writes CSV PNG JSON and confirmed data changes clear completed result and plots',async({page},info)=>{
  await page.setViewportSize({width:1440,height:900});await example(page);await nav(page,'结果汇总')
  await page.getByRole('checkbox',{name:'运行后导出 CSV / PNG',exact:true}).check()
  const body=await run(page)
  expect(body.exports_skipped).toBe(false);expect(body.export_error).toBeFalsy();expect(body.saved_files.length).toBeGreaterThanOrEqual(5)
  expect(body.saved_files.some(file=>file.endsWith('.csv'))).toBe(true);expect(body.saved_files.some(file=>file.endsWith('.png'))).toBe(true)
  expect(body.saved_files.some(file=>file.endsWith('Analysis_Record.json'))).toBe(true)
  for(const file of body.saved_files) {const bytes=await readFile(file);expect(bytes.length).toBeGreaterThan(0);if(file.endsWith('.png'))expect(bytes.subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a');if(file.endsWith('Analysis_Record.json'))expect(JSON.parse(bytes).report.metadata.plate_mapping.rows).toHaveLength(96)}
  await info.attach('actual-export-files',{body:JSON.stringify({output_dir:body.output_dir,saved_files:body.saved_files}),contentType:'application/json'})
  await screenshot(page,info,'plate-export-results-1440x900');await nav(page,'曲线预览');await screenshot(page,info,'plate-export-plots-1440x900')
  await nav(page,'原始数据');await well(page,'A1').click();await page.getByLabel('A1 原始 OD',{exact:true}).fill('0');await apply(page)
  await nav(page,'结果汇总');await expect(page.getByRole('heading',{name:'结果还未生成',exact:true})).toBeVisible()
  await nav(page,'曲线预览');await expect(page.getByRole('heading',{name:'暂无曲线预览',exact:true})).toBeVisible()
})

test('plate, right editor tabs, results, plots and history fit compact 1366×768 and 1440×900 layouts',async({page},info)=>{
  await example(page)
  for(const [width,height]of [[1366,768],[1440,900]]) {
    await page.setViewportSize({width,height});await screenshot(page,info,`plate-assign-${width}x${height}`)
    await page.getByRole('tab',{name:'分析约定',exact:true}).click();await expect(page.getByLabel('板图4PL拟合模式',{exact:true})).toBeVisible()
    await screenshot(page,info,`plate-analysis-${width}x${height}`);await page.getByRole('tab',{name:'标记选中孔',exact:true}).click()
  }
  await run(page)
  await expect.poll(async()=>page.evaluate(()=>new Promise(resolve=>{const open=indexedDB.open('elisa-analysis-history');open.onsuccess=()=>{const db=open.result,tx=db.transaction('snapshots','readonly'),request=tx.objectStore('snapshots').count();request.onsuccess=()=>resolve(request.result);tx.oncomplete=()=>db.close()}}))).toBeGreaterThan(0)
  for(const [width,height]of [[1366,768],[1440,900]]) {
    await page.setViewportSize({width,height});await nav(page,'结果汇总');await screenshot(page,info,`plate-results-${width}x${height}`)
    await nav(page,'曲线预览');await screenshot(page,info,`plate-plots-${width}x${height}`)
    await page.getByRole('button',{name:'分析历史',exact:true}).click();await expect(page.getByRole('dialog',{name:'分析历史',exact:true})).toBeVisible()
    await screenshot(page,info,`plate-history-${width}x${height}`);await page.getByRole('button',{name:'关闭历史',exact:true}).click()
  }
})
