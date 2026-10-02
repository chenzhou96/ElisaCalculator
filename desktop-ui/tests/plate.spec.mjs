import {test,expect} from '@playwright/test'
import {readFile} from 'node:fs/promises'
function response(page,command){return page.waitForResponse(r=>r.url().endsWith('/api/bridge')&&r.request().postDataJSON()?.command===command)}
const well=(page,id)=>page.locator(`[data-well="${id}"]`)
async function nav(page,name){await page.getByRole('navigation',{name:'分析导航'}).getByRole('button',{name:new RegExp(`^${name}`)}).click()}
async function parse(page){await page.getByRole('button',{name:'检查孔位映射',exact:true}).click();const r=response(page,'parse');await page.getByRole('button',{name:'确认映射并解析',exact:true}).click();expect((await(await r).json()).ok).toBe(true)}
async function run(page){const r=response(page,'run');await page.getByRole('button',{name:'运行分析',exact:true}).click();const b=await(await r).json();expect(b.ok,b.error).toBe(true);return b}
async function paste(page,text){await page.getByRole('button',{name:'粘贴读数',exact:true}).click();await page.getByRole('textbox',{name:'Excel 孔板读数'}).fill(text)}
async function screenshot(page,info,name){
 const box=await page.evaluate(()=>({viewport:[innerWidth,innerHeight],doc:[document.documentElement.scrollWidth,document.documentElement.scrollHeight],wells:[...document.querySelectorAll('[data-well]')].map(x=>{const r=x.getBoundingClientRect();return [x.dataset.well,r.x,r.y,r.right,r.bottom]})}))
 expect(box.doc[0]).toBeLessThanOrEqual(box.viewport[0]+1);expect(box.doc[1]).toBeLessThanOrEqual(box.viewport[1]+1)
 for(const [id,x,y,right,bottom]of box.wells){expect(x,id).toBeGreaterThanOrEqual(0);expect(y,id).toBeGreaterThanOrEqual(0);expect(right,id).toBeLessThanOrEqual(box.viewport[0]);expect(bottom,id).toBeLessThanOrEqual(box.viewport[1])}
 await page.screenshot({path:info.outputPath(name+'.png')});await info.attach(name+'-geometry',{body:JSON.stringify(box),contentType:'application/json'})
}
test.beforeEach(async({page})=>{page.__errors=[];page.on('pageerror',e=>page.__errors.push(e.message));await page.goto('/');await expect(page.getByRole('grid',{name:'96 孔板',exact:true})).toBeVisible()})
test.afterEach(async({page})=>expect(page.__errors).toEqual([]))

test('all 96 wells, empty cells and zero survive actual 8×12 paste; invalid imports require explicit whole import',async({page},info)=>{
 const rows=Array.from({length:8},(_,r)=>Array.from({length:12},(_,c)=>String((r+1)*100+c+1)));rows[0][0]='0';rows[2][4]='';rows[7][11]=''
 await paste(page,rows.map(r=>r.join('\t')).join('\n'));await expect(page.getByRole('status').filter({hasText:'8 × 12'})).toBeVisible();await page.getByRole('button',{name:'确认导入读数',exact:true}).click()
 await expect(well(page,'A1')).toContainText('0');await expect(well(page,'H1')).toContainText('801');await expect(well(page,'A12')).toContainText('112');await expect(well(page,'H12')).toContainText('—');expect(await page.locator('[data-well]').count()).toBe(96)
 await screenshot(page,info,'plate-coordinate-1366x768')
 await paste(page,'1\t2\n3');await expect(page.getByRole('button',{name:'确认导入读数',exact:true})).toBeDisabled();await page.getByRole('button',{name:'取消粘贴'}).click();await expect(well(page,'H1')).toContainText('801')
 await paste(page,'bad\t0');await expect(page.getByRole('button',{name:'确认导入读数',exact:true})).toBeDisabled();await page.getByLabel('保留非法文本及其坐标', {exact:false}).check();await page.getByLabel('确认覆盖现有读数', {exact:false}).check();await page.getByRole('button',{name:'确认导入读数',exact:true}).click();await expect(well(page,'A1')).toContainText('!');await expect(well(page,'A2')).toContainText('0')
 await page.getByRole('button',{name:'撤销孔板操作'}).click();await expect(well(page,'A1')).toContainText('0');await expect(well(page,'A2')).toContainText('102');await page.getByRole('button',{name:'重做孔板操作'}).click();await expect(well(page,'A1')).toContainText('!')
})
test('single, Cmd multi, Shift/keyboard and drag rectangles; duplicate columns restart gradient and undo atomically',async({page},info)=>{
 await well(page,'A1').click();await well(page,'C3').click({modifiers:['Meta']});expect(await page.locator('[aria-selected="true"][role="gridcell"]').count()).toBe(2)
 await well(page,'A1').click();await well(page,'C3').click({modifiers:['Shift']});expect(await page.locator('[aria-selected="true"][role="gridcell"]').count()).toBe(9)
 await well(page,'A1').focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('Shift+ArrowDown');expect(await page.locator('[aria-selected="true"][role="gridcell"]').count()).toBe(2)
 const a=await well(page,'D4').boundingBox(),b=await well(page,'F6').boundingBox();await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:8});await page.mouse.up();expect(await page.locator('[aria-selected="true"][role="gridcell"]').count()).toBe(9)
 await page.getByRole('button',{name:'选择第 2 列',exact:true}).click();await page.getByRole('button',{name:'选择第 1 列',exact:true}).click({modifiers:['Meta']});await page.getByLabel('起始量 / 浓度',{exact:true}).fill('128');await page.getByRole('button',{name:'应用到选中孔'}).click()
 for(const col of [1,2]){await expect(well(page,'A'+col)).toHaveAttribute('aria-label',/剂量 128$/);await expect(well(page,'H'+col)).toHaveAttribute('aria-label',/剂量 1$/)}
 await page.getByLabel('组名 / 样品名',{exact:true}).fill('Changed');await page.getByRole('button',{name:'应用到选中孔'}).click();await expect(page.getByRole('dialog',{name:'覆盖孔位标记？'})).toBeVisible();await page.getByRole('button',{name:'取消覆盖',exact:true}).click();await expect(well(page,'A1')).toHaveAttribute('aria-label',/Reference/)
 await page.getByRole('button',{name:'撤销孔板操作'}).click();await expect(well(page,'A1')).toHaveAttribute('aria-label',/未分配/);await page.getByRole('button',{name:'重做孔板操作'}).click();await expect(well(page,'A1')).toHaveAttribute('aria-label',/剂量 128$/)
 await screenshot(page,info,'plate-assigned-1366x768');await page.setViewportSize({width:1440,height:900});await screenshot(page,info,'plate-assigned-1440x900')
})
test('comparative plate mapping, 10X→40X, plot, export, saved plate restoration and edit invalidation',async({page},info)=>{
 await page.getByRole('button',{name:'载入板示例',exact:true}).click();await screenshot(page,info,'plate-comparison-1366x768');await page.setViewportSize({width:1440,height:900});await screenshot(page,info,'plate-comparison-1440x900');await page.getByRole('tab',{name:'分析约定',exact:true}).click();await screenshot(page,info,'plate-analysis-1440x900');await page.setViewportSize({width:1366,height:768});await screenshot(page,info,'plate-analysis-1366x768');await page.setViewportSize({width:1440,height:900});await nav(page,'分析设置');await page.getByRole('checkbox',{name:'运行后导出 CSV / PNG',exact:true}).check();await nav(page,'原始数据')
 await parse(page);const b=await run(page);expect(b.report.summary_rows.find(r=>r.Group==='Sample_4X').Relative_stock_potency_X).toBeCloseTo(40,4);expect(b.report.metadata.plate_mapping.rows).toHaveLength(96);expect(b.export_error).toBeFalsy();expect(b.saved_files.some(p=>p.endsWith('Analysis_Record.json'))).toBe(true);for(const f of b.saved_files){const bytes=await readFile(f);expect(bytes.length).toBeGreaterThan(0);if(f.endsWith('Analysis_Record.json'))expect(JSON.parse(bytes).report.metadata.plate_mapping.rows).toHaveLength(96)};await screenshot(page,info,'plate-comparison-results-1440x900')
 await nav(page,'曲线预览');const image=page.getByRole('img',{name:/4PL 拟合曲线/});await expect(image).toBeVisible();expect(await image.evaluate(e=>e.complete&&e.naturalWidth>0)).toBe(true);await screenshot(page,info,'plate-comparison-plots-1440x900')
 const event=page.waitForEvent('download');await page.getByRole('button',{name:'保存记录',exact:true}).click();const path=info.outputPath('plate-saved.json');await(await event).saveAs(path);const record=JSON.parse(await readFile(path,'utf8'));expect(record.inputs.inputView).toBe('plate');expect(record.inputs.plate.wells).toHaveLength(96);expect(record.inputs.options.reference_assigned_value).toBe(10)
 await nav(page,'原始数据');await page.getByRole('tab',{name:'标记选中孔',exact:true}).click();await well(page,'A1').click();await page.getByLabel('A1 原始 OD',{exact:true}).fill('0');await nav(page,'结果汇总');await expect(page.getByRole('heading',{name:'结果还未生成'})).toBeVisible()
 await page.getByRole('button',{name:'文件',exact:true}).click();const chooser=page.waitForEvent('filechooser');await page.getByRole('menuitem',{name:'恢复分析记录…',exact:true}).click();await(await chooser).setFiles(path);await expect(well(page,'A1')).toHaveAttribute('aria-label',/2.781493605490578/);await expect(page.getByRole('button',{name:'运行分析',exact:true})).toBeDisabled();await parse(page);const restored=await run(page);expect(restored.report.summary_rows.find(r=>r.Group==='Sample_4X').Relative_stock_potency_X).toBeCloseTo(40,4)
})
test('standard plate inverse 12×5=60; unknowns excluded from fit and independent table preserved',async({page},info)=>{
 await page.getByRole('button',{name:/^标准曲线\s*未知样品浓度反算$/}).click();await page.getByRole('button',{name:'载入板示例',exact:true}).click();await screenshot(page,info,'plate-standard-1366x768');await parse(page);const b=await run(page)
 expect(b.report.summary_rows[0].N).toBe(16);expect(b.report.unknown_results.find(r=>r.Sample==='Known_truth_12').Corrected_concentration).toBeCloseTo(60,4);expect(b.report.unknown_results.find(r=>r.Sample==='Below_range').Concentration).toBeNull();await screenshot(page,info,'plate-standard-results-1366x768')
 await nav(page,'原始数据');await page.getByRole('tab',{name:'表格输入',exact:true}).click();await page.getByRole('textbox',{name:'原始 ELISA 数据'}).fill('Dose,Legacy\n1,0');await page.getByRole('tab',{name:'96 孔板',exact:true}).click();await expect(well(page,'A3')).toHaveAttribute('aria-label',/未知样品 Known_truth_12/);await page.getByRole('tab',{name:'表格输入',exact:true}).click();await expect(page.getByRole('textbox',{name:'原始 ELISA 数据'})).toHaveValue('Dose,Legacy\n1,0')
})

test('a delayed real plate run is rejected after atomic exclusion/undo; a clipboard paste opens explicit preview',async({page},info)=>{
 await page.getByRole('button',{name:'载入板示例',exact:true}).click();await parse(page)
 let release,observed;const held=new Promise(r=>release=r),seen=new Promise(r=>observed=r)
 await page.route('**/api/bridge',async route=>{if(route.request().postDataJSON()?.command!=='run')return route.continue();const r=await route.fetch();observed();await held;await route.fulfill({response:r})})
 await page.getByRole('button',{name:'运行分析',exact:true}).click();await seen
 await well(page,'A1').click();await page.getByRole('combobox',{name:'孔类型',exact:true}).selectOption('excluded');await page.getByRole('button',{name:'应用到选中孔'}).click();await page.getByRole('button',{name:'确认覆盖孔位'}).click();await expect(well(page,'A1')).toHaveAttribute('aria-label',/排除/)
 await page.getByRole('button',{name:'撤销孔板操作'}).click();await expect(well(page,'A1')).toHaveAttribute('aria-label',/比较曲线 Reference/);release();await expect(page.getByRole('button',{name:'正在计算…',exact:true})).toHaveCount(0);await nav(page,'结果汇总');await expect(page.getByRole('heading',{name:'结果还未生成'})).toBeVisible()
 await nav(page,'原始数据');await well(page,'A1').focus();await well(page,'A1').evaluate(e=>{const data=new DataTransfer();data.setData('text/plain','0\t\n.5\t.6');e.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}))});await expect(page.getByRole('dialog',{name:'粘贴读数预览'})).toBeVisible();await expect(page.getByRole('textbox',{name:'Excel 孔板读数'})).toHaveValue('0\t\n.5\t.6');await page.screenshot({path:info.outputPath('plate-paste-preview-1366x768.png')});await page.getByRole('button',{name:'取消粘贴'}).click()
 await page.getByRole('button',{name:'检查孔位映射'}).click();await page.screenshot({path:info.outputPath('plate-mapping-review-1366x768.png')})
})
