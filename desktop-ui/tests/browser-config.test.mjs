import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const workflow = readFileSync(new URL('../../.github/workflows/verify.yml', import.meta.url), 'utf8')
const frontend = workflow.split(/^  frontend:\s*$/m)[1]
const sandboxedChrome = '/opt/google/chrome/chrome'

test('Ubuntu browser CI selects the preinstalled AppArmor-supported Chrome', () => {
  assert.ok(frontend, 'frontend verification job is present')
  assert.match(frontend, /runs-on: ubuntu-24\.04\s/)
  assert.match(frontend, /^      CHROMIUM_PATH: \/opt\/google\/chrome\/chrome\s*$/m)
  assert.match(frontend, /test -x "\$CHROMIUM_PATH"/)
})

test('explicit CI browser selection preserves the Chromium sandbox', () => {
  const config = JSON.parse(execFileSync(process.execPath, [
    '--experimental-strip-types', '--input-type=module', '-e',
    "import config from './playwright.config.mjs'; console.log(JSON.stringify(config.use.launchOptions))",
  ], {
    cwd: new URL('../', import.meta.url),
    env: { ...process.env, CHROMIUM_PATH: sandboxedChrome },
    encoding: 'utf8',
  }))
  assert.equal(config.executablePath, sandboxedChrome)
  assert.equal(config.chromiumSandbox, true)
  assert.equal((config.args || []).some(arg => /no-sandbox|disable.*sandbox/.test(arg)), false)
})
