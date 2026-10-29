import {test,expect} from '@playwright/test'
import {writeFile} from 'node:fs/promises'

// Real synthetic OD values, actual paste/batch UI and actual Python engine. No mocked results.
test('eight explicit column groups show normalized X and conditional CI in the first desktop viewport',async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.goto('/');await expect(page.getByRole('grid',{name:'96 孔板',exact:true})).toBeVisible()
 const factors=[1,2,4,.5,1.5,3,.75,1.25],names=['Reference','Sample_2X','Sample_4X','Sample_0.5X','Sample_1.5X','Sample_3X','Sample_0.75X','Sample_1.25X']
 const od=Array.from({length:8},(_,r)=>Array.from({length:12},(_,c)=>c<8?String(.08+2.8/(1+(.1767766952966369/factors[c]/(2**-r))**1.8)):'').join('\t')).join('\n')
 await page.getByRole('button',{name:'粘贴读数',exact:true}).click();await page.getByLabel('Excel 孔板读数').fill(od);await page.getByRole('button',{name:'确认导入读数',exact:true}).click()
 await page.getByRole('tab',{name:'批量分组',exact:true}).click();await page.getByLabel('批量组名（每行一组）',{exact:true}).fill(names.join('\n'));await page.getByLabel('每组复孔列数',{exact:true}).selectOption('1')
 await expect(page.locator('.batch-preview')).toContainText('8 组 · 64 孔')
 await expect(page.getByRole('button',{name:'应用批量分组',exact:true})).toBeInViewport({ratio:1})
 await page.screenshot({path:info.outputPath('plate-batch-preview-1366x768.png')})
 await page.getByRole('button',{name:'应用批量分组',exact:true}).click()
 await page.screenshot({path:info.outputPath('plate-batch-applied-1366x768.png')})
 await page.getByRole('tab',{name:'分析约定',exact:true}).click();await page.getByLabel('板图参比组',{exact:true}).selectOption('Reference');await page.getByLabel('板图参比赋值（X）',{exact:true}).fill('10')
 const wells=await page.locator('[data-well]').evaluateAll(elements=>elements.map(el=>{const r=el.getBoundingClientRect(),card=el.closest('.plate-board-card').getBoundingClientRect();return {id:el.dataset.well,top:r.top,bottom:r.bottom,cardBottom:card.bottom}}))
 await info.attach('input-geometry',{body:JSON.stringify(wells),contentType:'application/json'})
 await page.screenshot({path:info.outputPath('plate-eight-groups-1366x768.png')})
 expect(wells.length).toBe(96)
 for(const well of wells){expect(well.top,well.id).toBeGreaterThanOrEqual(0);expect(well.bottom,well.id).toBeLessThanOrEqual(742);expect(well.bottom,`${well.id} clipped by board`).toBeLessThanOrEqual(well.cardBottom)}
 const request=page.waitForResponse(r=>r.url().endsWith('/api/bridge')&&r.request().postDataJSON()?.command==='run');await page.getByRole('button',{name:'运行分析',exact:true}).click();const result=await(await request).json();expect(result.ok,result.error).toBe(true)
 await expect(page.getByRole('table',{name:'各组相对参比结果'})).toBeVisible()
 const ci=page.locator('.inspector-ci');await expect(ci).toContainText('dimensionless dose')
 const ciGeometry=await ci.evaluate(el=>{const p=el.getBoundingClientRect();return [...el.querySelectorAll('.inspector-ci-bound')].map(bound=>{const r=bound.getBoundingClientRect(),style=getComputedStyle(bound);return {text:bound.textContent,left:r.left,right:r.right,height:r.height,lineHeight:parseFloat(style.lineHeight),containerLeft:p.left,containerRight:p.right}})})
 for(const bound of ciGeometry){expect(bound.height,`CI bound ${bound.text} must not split into fragments`).toBeLessThanOrEqual(bound.lineHeight+1);expect(bound.left).toBeGreaterThanOrEqual(bound.containerLeft);expect(bound.right).toBeLessThanOrEqual(bound.containerRight)}
 await info.attach('inspector-ci-geometry',{body:JSON.stringify(ciGeometry),contentType:'application/json'})

 for(let i=0;i<names.length;i++)expect(result.report.summary_rows.find(r=>r.Group===names[i]).Normalized_midpoint_X).toBeCloseTo(10*factors[i],3)
 const geometry=await page.locator('.comparison-table tbody tr').evaluateAll(rows=>rows.map(row=>{const r=row.getBoundingClientRect(),container=row.closest('.results-layout').getBoundingClientRect(),footer=document.querySelector('.status-bar').getBoundingClientRect(),visibleBottom=Math.min(container.bottom,innerHeight,footer.top),visibleLeft=Math.max(container.left,0),visibleRight=Math.min(container.right,innerWidth);return {group:row.querySelector('button').textContent,top:r.top,bottom:r.bottom,left:r.left,right:r.right,visibleBottom,visible:r.top>=Math.max(container.top,0)&&r.bottom<=visibleBottom&&r.left>=visibleLeft&&r.right<=visibleRight}}))
 await writeFile(info.outputPath('results-first-viewport.json'),JSON.stringify({viewport:[1366,768],rows:geometry,visibleRows:geometry.filter(r=>r.visible).length},null,2))
 await page.screenshot({path:info.outputPath('results-eight-groups-1366x768.png')})
 expect(geometry.length).toBe(8);expect(geometry.filter(r=>r.visible).length).toBeGreaterThanOrEqual(6)
 await page.getByRole('button',{name:'切换到夜间模式'}).click();await page.screenshot({path:info.outputPath('results-eight-groups-night-1366x768.png')})
 await page.setViewportSize({width:1440,height:900});await page.screenshot({path:info.outputPath('results-eight-groups-night-1440x900.png')})
 await page.getByRole('navigation',{name:'分析导航'}).getByRole('button',{name:'曲线预览',exact:true}).click();await expect(page.getByRole('img',{name:/4PL 拟合曲线/})).toBeVisible();await page.screenshot({path:info.outputPath('curves-eight-groups-night-1440x900.png')})
 expect(errors).toEqual([])
})
