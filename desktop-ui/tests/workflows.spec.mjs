import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const comparison = JSON.parse(await readFile(new URL('../../examples/comparison_request.json', import.meta.url), 'utf8'))
const standard = JSON.parse(await readFile(new URL('../../examples/standard_request.json', import.meta.url), 'utf8'))
const fixtures = fileURLToPath(new URL('../../examples/', import.meta.url))

function bridgeResponse(page, command) {
  return page.waitForResponse(response => response.url().endsWith('/api/bridge') && response.request().postDataJSON()?.command === command)
}
async function nav(page, name) { await page.getByRole('navigation', {name: '分析导航'}).getByRole('button', {name: new RegExp(`^${name}`)}).click() }
async function parse(page, raw) {
  await page.getByRole('textbox', {name: '原始 ELISA 数据'}).fill(raw)
  const response = bridgeResponse(page, 'parse')
  await page.getByRole('button', {name: '解析预览', exact: true}).click()
  const body = await (await response).json()
  expect(body.ok).toBe(true)
  await expect(page.getByRole('combobox', {name: 'X 轴列', exact: true})).toBeVisible()
  return body
}
async function run(page) {
  const response = bridgeResponse(page, 'run')
  await page.getByRole('button', {name: '运行分析', exact: true}).click()
  const body = await (await response).json()
  expect(body.ok, body.error).toBe(true)
  await expect(page.getByRole('heading', {name: /曲线参数与比较|未知样品浓度/})).toBeVisible()
  return body
}
async function prepareComparison(page) {
  await parse(page, comparison.raw_text)
  await nav(page, '分析设置')
  await page.getByRole('combobox', {name: '参考组', exact: true}).selectOption('Reference')
  await page.getByRole('spinbutton', {name: '参考组赋值（X）', exact: true}).fill('10')
}
async function screenshot(page, testInfo, name) {
  const dimensions = await page.evaluate(() => ({viewport: [innerWidth, innerHeight], document: [document.documentElement.scrollWidth, document.documentElement.scrollHeight]}))
  expect(dimensions.document[0], `${name}: page must not overflow horizontally`).toBeLessThanOrEqual(dimensions.viewport[0] + 1)
  await page.screenshot({path: testInfo.outputPath(`${name}.png`), fullPage: false})
  await testInfo.attach(`${name}-dimensions`, {body: JSON.stringify(dimensions), contentType: 'application/json'})
}

test.beforeEach(async ({page}) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {if (message.type() === 'error') errors.push(message.text())})
  page.__errors = errors
  await page.goto('/')
  await expect(page.getByRole('textbox', {name: '原始 ELISA 数据'})).toBeVisible()
})
test.afterEach(async ({page}, testInfo) => {
  await testInfo.attach('browser-console-errors', {body: JSON.stringify(page.__errors), contentType: 'application/json'})
  expect(page.__errors, 'No runtime or console errors').toEqual([])
})

test('truth comparison, reference 10X, real plot with save off and settings invalidation', async ({page}, testInfo) => {
  await prepareComparison(page)
  await screenshot(page, testInfo, 'comparison-settings-1366x768')
  const body = await run(page)
  expect(body.exports_skipped).toBe(true)
  expect(body.previews.length).toBeGreaterThanOrEqual(3)
  const reference = body.report.summary_rows.find(row => row.Group === 'Reference')
  const sample = body.report.summary_rows.find(row => row.Group === 'Sample_4X')
  expect(reference.Relative_stock_potency_X).toBeCloseTo(10, 4)
  expect(sample.Relative_stock_potency_X).toBeCloseTo(40, 4)
  const sampleRow = page.getByRole('row').filter({has: page.getByRole('cell', {name: 'Sample_4X', exact: true})})
  await expect(sampleRow).toContainText('40 X')
  await screenshot(page, testInfo, 'comparison-results-1366x768')
  await nav(page, '曲线预览')
  const image = page.getByRole('img', {name: /4PL 拟合曲线/})
  await expect(image).toBeVisible()
  expect(await image.evaluate(element => element.complete && element.naturalWidth > 0)).toBe(true)
  await screenshot(page, testInfo, 'comparison-plots-1366x768')
  await nav(page, '分析设置')
  await page.getByRole('spinbutton', {name: '参考组赋值（X）', exact: true}).fill('1')
  await nav(page, '结果汇总')
  await expect(page.getByRole('heading', {name: '结果还未生成'})).toBeVisible()
  await nav(page, '曲线预览')
  await expect(page.getByRole('heading', {name: '暂无曲线预览'})).toBeVisible()
})

test('example and native-file import, header override, invalid data and pagination', async ({page}, testInfo) => {
  await page.getByRole('button', {name: '载入示例', exact: true}).click()
  await expect(page.getByRole('textbox', {name: '原始 ELISA 数据'})).toHaveValue(/Reference/)
  await parse(page, await page.getByRole('textbox', {name: '原始 ELISA 数据'}).inputValue())
  await screenshot(page, testInfo, 'comparison-data-1366x768')
  await page.getByRole('button', {name: '下一页', exact: true}).click()
  await expect(page.getByText('6–8 / 8', {exact: true})).toBeVisible()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', {name: '导入文件', exact: true}).click()
  await (await chooser).setFiles(`${fixtures}comparison_8_steps.csv`)
  await expect(page.getByRole('textbox', {name: '原始 ELISA 数据'})).toHaveValue(comparison.raw_text)
  await page.getByRole('combobox', {name: '首行表头', exact: true}).selectOption('present')
  await parse(page, comparison.raw_text)
  const numeric = '1,0.1,0.2\n2,0.3,0.4\n3,0.5,0.6\n4,0.7,0.8'
  await page.getByRole('combobox', {name: '首行表头', exact: true}).selectOption('absent')
  const parsed = await parse(page, numeric)
  expect(parsed.row_count).toBe(4)
  expect(parsed.meta.columns).toHaveLength(3)
  await page.getByRole('textbox', {name: '原始 ELISA 数据'}).fill('only_one_column\nnot_a_table')
  const response = bridgeResponse(page, 'parse')
  await page.getByRole('button', {name: '解析预览', exact: true}).click()
  expect((await (await response).json()).ok).toBe(false)
  await expect(page.getByRole('alert')).toBeVisible()
})

test('standard truth 12 times 5 equals 60 and out-of-range samples remain unquantified', async ({page}, testInfo) => {
  await page.getByRole('button', {name: /^标准曲线\s*未知样品浓度反算$/}).click()
  await parse(page, standard.raw_text)
  await nav(page, '分析设置')
  await page.getByRole('combobox', {name: '输入方式', exact: true}).selectOption('raw_concentration')
  await page.getByRole('combobox', {name: '标准曲线', exact: true}).selectOption('Standard')
  await page.getByRole('combobox', {name: '4PL 拟合模式', exact: true}).selectOption('independent')
  await nav(page, '未知样品')
  const known = standard.analysis_options.unknown_samples[0]
  const below = standard.analysis_options.unknown_samples[1]
  await page.getByLabel('样品名称 1', {exact: true}).fill(known.sample_id)
  await page.getByLabel('样品 OD 1', {exact: true}).fill(known.od.join('; '))
  await page.getByLabel('样品稀释倍数 1', {exact: true}).fill(String(known.dilution_factor))
  await page.getByRole('button', {name: '＋ 添加样品', exact: true}).click()
  await page.getByLabel('样品名称 2', {exact: true}).fill(below.sample_id)
  await page.getByLabel('样品 OD 2', {exact: true}).fill(String(below.od))
  await screenshot(page, testInfo, 'standard-unknowns-1366x768')
  const body = await run(page)
  const knownResult = body.report.unknown_results.find(row => row.Sample === known.sample_id)
  const belowResult = body.report.unknown_results.find(row => row.Sample === below.sample_id)
  expect(knownResult.Concentration).toBeCloseTo(12, 5)
  expect(knownResult.Corrected_concentration).toBeCloseTo(60, 4)
  expect(belowResult.Concentration).toBeNull()
  expect(belowResult.Corrected_concentration).toBeNull()
  expect(belowResult.Status).not.toBe('Success')
  const knownRow = page.getByRole('row').filter({has: page.getByRole('cell', {name: known.sample_id, exact: true})})
  await expect(knownRow).toContainText('12')
  await expect(knownRow).toContainText('60')
  await expect(knownRow).toContainText('ng/mL')
  const belowRow = page.getByRole('row').filter({has: page.getByRole('cell', {name: below.sample_id, exact: true})})
  await expect(belowRow).toContainText('—')
  await screenshot(page, testInfo, 'standard-results-1366x768')
  for (const [width, height] of [[1440,900], [960,720]]) {
    await page.setViewportSize({width,height})
    await screenshot(page, testInfo, `standard-results-${width}x${height}`)
    await nav(page, '分析设置')
    await screenshot(page, testInfo, `standard-settings-${width}x${height}`)
    await nav(page, '结果汇总')
  }
})

test('pending real calculation cannot restore results after the input is edited', async ({page}) => {
  await prepareComparison(page)
  let releaseResponse
  let observed
  const observedPromise = new Promise(resolve => {observed = resolve})
  const hold = new Promise(resolve => {releaseResponse = resolve})
  await page.route('**/api/bridge', async route => {
    if (route.request().postDataJSON()?.command !== 'run') return route.continue()
    const response = await route.fetch()
    observed()
    await hold
    await route.fulfill({response})
  })
  await page.getByRole('button', {name: '运行分析', exact: true}).click()
  await observedPromise
  await nav(page, '原始数据')
  await page.getByRole('textbox', {name: '原始 ELISA 数据'}).fill(comparison.raw_text.replace('Reference', 'NewReference'))
  releaseResponse()
  await expect(page.getByRole('button', {name: '正在计算…', exact: true})).toHaveCount(0)
  await nav(page, '结果汇总')
  await expect(page.getByRole('heading', {name: '结果还未生成'})).toBeVisible()
})

test('portable JSON saves truth, restores only inputs, and reset cancellation keeps work', async ({page}, testInfo) => {
  await prepareComparison(page)
  await run(page)
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', {name: '保存记录', exact: true}).click()
  const download = await downloadEvent
  const path = testInfo.outputPath('saved-analysis.json')
  await download.saveAs(path)
  const saved = JSON.parse(await readFile(path, 'utf8'))
  expect(saved.schema).toBe('elisa-analysis/1')
  expect(saved.inputs.rawText).toBe(comparison.raw_text)
  expect(saved.inputs.options.reference_assigned_value).toBe(10)
  expect(saved.result.report.summary_rows.find(row => row.Group === 'Sample_4X').Relative_stock_potency_X).toBeCloseTo(40, 4)
  await page.getByRole('button', {name: '文件', exact: true}).click()
  await page.getByRole('menuitem', {name: '新建分析', exact: true}).click()
  await expect(page.getByRole('dialog', {name: '新建分析？'})).toBeVisible()
  await page.getByRole('button', {name: '取消', exact: true}).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('cell', {name: '40 X', exact: true})).toBeVisible()
  await nav(page, '原始数据')
  await page.getByRole('textbox', {name: '原始 ELISA 数据'}).fill('edited data')
  await page.getByRole('button', {name: '文件', exact: true}).click()
  const chooserEvent = page.waitForEvent('filechooser')
  await page.getByRole('menuitem', {name: '恢复分析记录…', exact: true}).click()
  await (await chooserEvent).setFiles(path)
  await expect(page.getByRole('textbox', {name: '原始 ELISA 数据'})).toHaveValue(comparison.raw_text)
  await expect(page.getByRole('button', {name: '运行分析', exact: true})).toBeDisabled()
  await nav(page, '结果汇总')
  await expect(page.getByRole('heading', {name: '结果还未生成'})).toBeVisible()
  await nav(page, '分析设置')
  await expect(page.getByRole('spinbutton', {name: '参考组赋值（X）', exact: true})).toHaveValue('10')
  await nav(page, '原始数据')
  await parse(page, comparison.raw_text)
  await run(page)
  await expect(page.getByRole('cell', {name: '40 X', exact: true})).toBeVisible()
  await page.getByRole('button', {name: '文件', exact: true}).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
})

// Supplemental iMac acceptance: persistent exports and completed-result invalidation.
test('iMac persistent export writes CSV PNG JSON and completed data edits clear result and plot', async ({page}, testInfo) => {
  await page.setViewportSize({width: 1440, height: 900})
  await prepareComparison(page)
  await page.getByRole('checkbox', {name: '运行后导出 CSV / PNG', exact: true}).check()
  await screenshot(page, testInfo, 'comparison-export-settings-1440x900')
  const body = await run(page)
  expect(body.exports_skipped).toBe(false)
  expect(body.export_error).toBeFalsy()
  expect(body.saved_files.length).toBeGreaterThanOrEqual(5)
  expect(body.saved_files.some(path => path.endsWith('.csv'))).toBe(true)
  expect(body.saved_files.some(path => path.endsWith('.png'))).toBe(true)
  expect(body.saved_files.some(path => path.endsWith('Analysis_Record.json'))).toBe(true)
  for (const path of body.saved_files) {
    const bytes = await readFile(path)
    expect(bytes.length).toBeGreaterThan(0)
    if (path.endsWith('.png')) expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  }
  await testInfo.attach('actual-export-files', {body: JSON.stringify({output_dir: body.output_dir, saved_files: body.saved_files}), contentType: 'application/json'})
  await screenshot(page, testInfo, 'comparison-export-results-1440x900')
  await nav(page, '曲线预览')
  const image = page.getByRole('img', {name: /4PL 拟合曲线/})
  await expect(image).toBeVisible()
  expect(await image.evaluate(element => element.complete && element.naturalWidth > 0)).toBe(true)
  await screenshot(page, testInfo, 'comparison-export-plots-1440x900')
  await nav(page, '原始数据')
  await page.getByRole('textbox', {name: '原始 ELISA 数据'}).fill(comparison.raw_text.replace('Reference', 'EditedReference'))
  await nav(page, '结果汇总')
  await expect(page.getByRole('heading', {name: '结果还未生成'})).toBeVisible()
  await nav(page, '曲线预览')
  await expect(page.getByRole('heading', {name: '暂无曲线预览'})).toBeVisible()
})

test('five preview rows fit without internal or page scrolling at 1366 and 1440', async ({page}, testInfo) => {
  await page.getByRole('button', {name: '载入示例', exact: true}).click()
  await parse(page, await page.getByRole('textbox', {name: '原始 ELISA 数据'}).inputValue())
  for (const [width, height] of [[1366, 768], [1440, 900]]) {
    await page.setViewportSize({width, height})
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const geometry = await page.locator('.preview-card .table-scroll').evaluate(box => {
      const clip = box.getBoundingClientRect()
      return {
        viewport: [innerWidth, innerHeight],
        document: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
        clientHeight: box.clientHeight,
        scrollHeight: box.scrollHeight,
        rows: [...box.querySelectorAll('tbody tr')].map(row => {
          const rect = row.getBoundingClientRect()
          return {text: row.textContent, fullyVisible: rect.top >= clip.top - 0.5 && rect.bottom <= clip.bottom + 0.5}
        }),
      }
    })
    expect(geometry.rows).toHaveLength(5)
    expect(geometry.rows.every(row => row.fullyVisible), JSON.stringify(geometry)).toBe(true)
    expect(geometry.scrollHeight).toBeLessThanOrEqual(geometry.clientHeight)
    expect(geometry.document).toEqual(geometry.viewport)
    await testInfo.attach(`five-row-geometry-${width}x${height}`, {body: JSON.stringify(geometry), contentType: 'application/json'})
    await screenshot(page, testInfo, `five-row-data-${width}x${height}`)
  }
  await page.getByRole('button', {name: '下一页', exact: true}).click()
  await expect(page.getByText('6–8 / 8', {exact: true})).toBeVisible()
  await expect(page.locator('.preview-card tbody tr')).toHaveCount(3)
  await page.getByRole('button', {name: '上一页', exact: true}).click()
  await expect(page.getByText('1–5 / 8', {exact: true})).toBeVisible()
  await page.getByRole('combobox', {name: 'X 轴列', exact: true}).focus()
  await expect(page.getByRole('combobox', {name: 'X 轴列', exact: true})).toBeFocused()
})
