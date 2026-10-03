import { test, expect } from '@playwright/test'
import { inflateSync } from 'node:zlib'

const well = (page, id) => page.locator(`[data-well="${id}"]`)
const navigation = page => page.getByRole('navigation', { name: '分析导航' })
const nav = (page, name) => navigation(page).getByRole('button', { name, exact: true }).click()

// Decode the browser's 8-bit PNG, including its row filters. Pixel assertions
// below check that each OD is actually painted, not just present in the DOM.
function decodePng(png) {
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  let width, height, channels
  const chunks = []
  for (let offset = 8; offset < png.length;) {
    const size = png.readUInt32BE(offset), kind = png.toString('ascii', offset + 4, offset + 8)
    const data = png.subarray(offset + 8, offset + 8 + size)
    if (kind === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4)
      expect(data[8], '8-bit browser screenshot').toBe(8)
      expect([2, 6], 'RGB/RGBA browser screenshot').toContain(data[9])
      expect(data[12], 'non-interlaced browser screenshot').toBe(0)
      channels = data[9] === 6 ? 4 : 3
    }
    if (kind === 'IDAT') chunks.push(data)
    offset += size + 12
  }
  const source = inflateSync(Buffer.concat(chunks)), stride = width * channels
  const pixels = Buffer.alloc(height * stride)
  expect(source.length).toBe(height * (stride + 1))
  const paeth = (a, b, c) => {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
  }
  for (let y = 0; y < height; y++) {
    const filter = source[y * (stride + 1)]
    expect(filter).toBeLessThanOrEqual(4)
    for (let x = 0; x < stride; x++) {
      const index = y * stride + x
      const a = x >= channels ? pixels[index - channels] : 0
      const b = y ? pixels[index - stride] : 0
      const c = y && x >= channels ? pixels[index - stride - channels] : 0
      const predictor = [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter]
      pixels[index] = (source[y * (stride + 1) + x + 1] + predictor) & 255
    }
  }
  return { width, height, channels, pixels }
}

async function capture(page, info, name, { board = false } = {}) {
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
  const geometry = await page.evaluate(() => {
    const rect = element => {
      const { left, top, right, bottom, width, height } = element.getBoundingClientRect()
      return { left, top, right, bottom, width, height }
    }
    return {
      viewport: { width: innerWidth, height: innerHeight, scale: devicePixelRatio },
      document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
      boxes: [...document.querySelectorAll('.plate-board-card,.plate-editor-body,.results-layout,.table-scroll,.reference-controls,.history-list')].map(element => ({
        name: element.className, ...rect(element), clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth, clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight, scrollTop: element.scrollTop,
      })),
      grid: document.querySelector('.plate-grid') ? rect(document.querySelector('.plate-grid')) : null,
      wells: [...document.querySelectorAll('[data-well]')].map(element => {
        const od = element.querySelector('strong'), range = document.createRange()
        range.selectNodeContents(od)
        return {
          id: element.dataset.well, ...rect(element), od: rect(od),
          text: rect({ getBoundingClientRect: () => range.getBoundingClientRect() }),
          font: parseFloat(getComputedStyle(od).fontSize),
          color: getComputedStyle(od).color.match(/[\d.]+/g).slice(0, 3).map(Number),
        }
      }),
    }
  })
  expect(geometry.viewport.scale).toBe(1.5)
  expect(geometry.document.width, `${name}: page horizontal overflow`).toBeLessThanOrEqual(geometry.viewport.width + 1)
  expect(geometry.document.height, `${name}: page vertical overflow`).toBeLessThanOrEqual(geometry.viewport.height + 1)
  for (const box of geometry.boxes) {
    expect(box.scrollWidth, `${name}: ${box.name} horizontal overflow`).toBeLessThanOrEqual(box.clientWidth + 1)
  }
  if (board) {
    expect(geometry.wells).toHaveLength(96)
    const boardBox = geometry.boxes.find(box => box.name.includes('plate-board-card'))
    expect(boardBox.scrollTop, 'board does not scroll to reach lower rows').toBe(0)
    expect(boardBox.scrollHeight, 'board content fits without vertical scroll').toBeLessThanOrEqual(boardBox.clientHeight + 1)
    for (const box of geometry.wells) {
      expect(box.left, box.id).toBeGreaterThanOrEqual(geometry.grid.left - 1)
      expect(box.right, box.id).toBeLessThanOrEqual(geometry.grid.right + 1)
      expect(box.top, box.id).toBeGreaterThanOrEqual(geometry.grid.top - 1)
      expect(box.bottom, box.id).toBeLessThanOrEqual(geometry.grid.bottom + 1)
      expect(box.bottom, box.id).toBeLessThanOrEqual(geometry.viewport.height)
      expect(box.height, `${box.id}: usable compact well height`).toBeGreaterThanOrEqual(30)
      expect(box.font, `${box.id}: OD remains 15 physical pixels at 150%`).toBeGreaterThanOrEqual(10)
      expect(box.text.left, `${box.id}: OD left clipping`).toBeGreaterThanOrEqual(box.left + 1)
      expect(box.text.right, `${box.id}: OD right clipping`).toBeLessThanOrEqual(box.right - 1)
      expect(box.text.top, `${box.id}: OD top clipping`).toBeGreaterThanOrEqual(box.top)
      expect(box.text.bottom, `${box.id}: OD bottom clipping`).toBeLessThanOrEqual(box.bottom)
    }
  }
  const png = await page.screenshot({ path: info.outputPath(`${name}.png`), animations: 'disabled', fullPage: false })
  const bitmap = decodePng(png), sx = bitmap.width / geometry.viewport.width, sy = bitmap.height / geometry.viewport.height
  // Fractional physical dimensions may round either way in the screenshot
  // transport; the raster must still match the real 150% device scale.
  expect(Math.abs(bitmap.width - geometry.viewport.width * 1.5)).toBeLessThanOrEqual(0.5)
  expect(Math.abs(bitmap.height - geometry.viewport.height * 1.5)).toBeLessThanOrEqual(0.5)
  if (board) for (const box of geometry.wells) {
    let painted = 0
    for (let y = Math.max(0, Math.floor(box.text.top * sy)); y < Math.min(bitmap.height, Math.ceil(box.text.bottom * sy)); y++) {
      for (let x = Math.max(0, Math.floor(box.text.left * sx)); x < Math.min(bitmap.width, Math.ceil(box.text.right * sx)); x++) {
        const offset = (y * bitmap.width + x) * bitmap.channels
        if (box.color.every((value, c) => Math.abs(bitmap.pixels[offset + c] - value) <= 35)) painted++
      }
    }
    expect(painted, `${box.id}: screenshot contains painted OD text`).toBeGreaterThanOrEqual(2)
  }
  await info.attach(`${name}-geometry`, { body: JSON.stringify(geometry), contentType: 'application/json' })
  await info.attach(`${name}-image`, { body: png, contentType: 'image/png' })
}

test.describe('150% display scaling and monitor work-area layouts', () => {
  test.use({ deviceScaleFactor: 1.5 })
  for (const [width, height] of [[910, 512], [910, 480], [894, 464], [889, 459]]) {
    test(`96 wells, OD pixels, editor, navigation and result images fit ${width}×${height} logical pixels`, async ({ page }, info) => {
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
      await page.setViewportSize({ width, height })
      await page.goto('/')
      await expect(page.getByRole('grid', { name: '96 孔板', exact: true })).toBeVisible()
      await expect(page.locator('.status-bar')).toContainText('已自动保存到本机')
      await capture(page, info, `empty-150pct-${width}x${height}`, { board: true })
      for (const name of ['原始数据', '结果汇总', '曲线预览']) {
        const button = navigation(page).getByRole('button', { name, exact: true })
        await expect(button).toBeInViewport({ ratio: 1 })
        await expect(button).toHaveAttribute('title', name)
      }
      await expect(page.getByRole('button', { name: '使用说明', exact: true })).toBeInViewport({ ratio: 1 })
      await page.getByRole('button', { name: '载入板示例', exact: true }).click()
      await capture(page, info, `assigned-150pct-${width}x${height}`, { board: true })

      // Reach the bottom-right well by keyboard, then scroll only the editor
      // to its raw-reading control. The staged edit must not mutate the plate.
      await well(page, 'H1').focus()
      for (let i = 0; i < 11; i++) await page.keyboard.press('ArrowRight')
      await expect(well(page, 'H12')).toBeFocused()
      const original = await well(page, 'H12').getAttribute('aria-label')
      const raw = page.getByLabel('H12 原始 OD', { exact: true })
      await raw.scrollIntoViewIfNeeded()
      await expect(raw).toBeInViewport({ ratio: 1 })
      expect(await page.locator('.plate-editor-body').evaluate(element => element.scrollTop)).toBeGreaterThan(0)
      await raw.fill('=4/2'); await raw.press('Tab')
      await expect(raw).toHaveValue('2')
      await expect(well(page, 'H12')).toHaveAttribute('aria-label', original)
      await page.getByRole('button', { name: '取消修改', exact: true }).click()
      await capture(page, info, `editor-scrolled-150pct-${width}x${height}`, { board: true })

      await page.getByRole('tab', { name: '分析约定', exact: true }).click()
      const scope = page.getByLabel('空白校正作用域', { exact: true })
      await scope.scrollIntoViewIfNeeded(); await scope.focus()
      await expect(scope).toBeFocused(); await expect(scope).toBeInViewport({ ratio: 1 })
      await capture(page, info, `analysis-150pct-${width}x${height}`, { board: true })
      await page.getByRole('button', { name: '切换到夜间模式', exact: true }).click()
      await capture(page, info, `night-150pct-${width}x${height}`, { board: true })
      await page.getByRole('button', { name: '切换到日间模式', exact: true }).click()

      const response = page.waitForResponse(value => value.url().endsWith('/api/bridge') && value.request().postDataJSON()?.command === 'run')
      await page.getByRole('button', { name: '运行分析', exact: true }).click()
      const result = await (await response).json()
      expect(result.ok, result.error).toBe(true)
      await expect(page.getByRole('cell', { name: '40 X', exact: true })).toBeVisible()
      await capture(page, info, `results-150pct-${width}x${height}`)
      await nav(page, '曲线预览')
      const image = page.getByRole('img', { name: /4PL 拟合曲线/ })
      await expect(image).toBeInViewport({ ratio: 1 })
      expect(await image.getAttribute('src')).toBe(result.previews[0].data_url)
      expect(await image.evaluate(element => element.complete && element.naturalWidth > 0)).toBe(true)
      await capture(page, info, `plots-150pct-${width}x${height}`)
      await page.getByRole('button', { name: '分析历史', exact: true }).click()
      await expect(page.getByRole('dialog', { name: '分析历史', exact: true })).toBeInViewport({ ratio: 1 })
      await expect(page.getByRole('button', { name: '关闭历史', exact: true })).toBeInViewport({ ratio: 1 })
      await capture(page, info, `history-150pct-${width}x${height}`)
      await page.getByRole('button', { name: '关闭历史', exact: true }).click()
      await page.getByRole('button', { name: '使用说明', exact: true }).click()
      await expect(page.getByRole('heading', { name: '使用说明', exact: true })).toBeVisible()
      await nav(page, '原始数据')
      await capture(page, info, `returned-150pct-${width}x${height}`, { board: true })
      expect(errors, 'No browser runtime or console errors').toEqual([])
    })
  }
})
