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

test('Windows job initializes runner-specific paths at runtime rather than unavailable job env context', async () => {
  const source = readFileSync(new URL('../../.github/workflows/windows-installer.yml', import.meta.url), 'utf8')
  const jobEnv = source.split('    env:\n')[1]?.split('    steps:')[0] ?? ''
  assert.doesNotMatch(jobEnv,/\$\{\{\s*runner\./)
  assert.match(source,/Join-Path \$env:RUNNER_TEMP 'elisa-matplotlib'/)
  assert.match(source,/"MPLCONFIGDIR=\$plotCache" >> \$env:GITHUB_ENV/)
})

test('native startup is initially visible and bounded without requiring an early show message', () => {
  const config = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'))
  const window = config.app.windows[0]
  assert.equal(window.visible, true)
  assert.equal(window.center, true)
  assert.equal(window.preventOverflow, true)
  assert.deepEqual([window.width, window.height, window.minWidth, window.minHeight], [800, 420, 800, 420])
})

test('native fitting waits for Ready after setup and stays on the runtime event-loop callback', () => {
  const source = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8')
  const setup = source.split('.setup(|app|')[1]?.split('.build(tauri::generate_context!())')[0] ?? ''
  assert.ok(setup)
  assert.doesNotMatch(setup, /fit_initial_window|window-startup|\.show\(/)
  const ready = source.split('.run(|app, event|')[1] ?? ''
  assert.match(ready, /matches!\(event, tauri::RunEvent::Ready\)/)
  assert.match(ready, /get_webview_window\("main"\)/)
  assert.match(ready, /fit_initial_window\(&window\)/)
  assert.doesNotMatch(ready, /std::thread|spawn\(/)
})
