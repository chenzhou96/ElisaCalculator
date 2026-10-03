import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Opt-in local development/test adapter. Never included in production assets.
function localScientificBridge(): Plugin {
  return {
    name: 'local-scientific-bridge',
    configureServer(server) {
      if (process.env.VITE_ELISA_DEV_BRIDGE !== '1') return
      server.middlewares.use('/api/bridge', (req, res) => {
        const remote = req.socket.remoteAddress ?? ''
        const origin = req.headers.origin
        if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)
          || (origin && origin !== `http://${req.headers.host}`)) {
          res.statusCode = 403; res.end('Local development access only'); return
        }
        if (req.method !== 'POST' || !req.headers['content-type']?.startsWith('application/json')) {
          res.statusCode = 405; res.end('JSON POST required'); return
        }
        let body = ''
        let tooLarge = false
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString('utf8')
          if (Buffer.byteLength(body) > 32_000_000) { tooLarge = true; req.destroy() }
        })
        req.on('end', () => {
          if (tooLarge) return
          let payload: Record<string, unknown>
          try {
            payload = JSON.parse(body) as Record<string, unknown>
            if (!['parse', 'run', 'normalize_text', 'renormalize'].includes(String(payload.command))
              || (payload.command !== 'renormalize' && typeof payload.raw_text !== 'string')
              || (payload.command === 'renormalize' && (!payload.run_response || typeof payload.run_response !== 'object'))
              || 'file_path' in payload || 'output_dir' in payload) throw Error('Unsupported local request')
          } catch { res.statusCode = 400; res.end('Invalid bridge request'); return }
          const child = spawn(process.env.ELISA_PYTHON ?? 'python', ['-m', 'elisa_calculator.bridge'], {
            cwd: fileURLToPath(new URL('../', import.meta.url)),
            env: { ...process.env, MPLCONFIGDIR: process.env.MPLCONFIGDIR ?? '/tmp/elisa-matplotlib', PYTHONIOENCODING: 'utf-8' },
            stdio: ['pipe', 'pipe', 'pipe'],
          })
          let output = '', errors = '', ended = false
          const respond = (status: number, content: string) => {
            if (ended) return
            ended = true; clearTimeout(timer)
            res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(content)
          }
          const timer = setTimeout(() => {
            child.kill(); respond(504, JSON.stringify({ ok: false, error: 'Calculation timed out after 120 seconds' }))
          }, 120_000)
          child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString('utf8') })
          child.stderr.on('data', (chunk: Buffer) => { errors = (errors + chunk.toString('utf8')).slice(-4000) })
          child.on('error', (error) => respond(500, JSON.stringify({ ok: false, error: error.message })))
          child.on('close', (code) => {
            if (code === 0 && output.trim()) respond(200, output)
            else respond(500, JSON.stringify({ ok: false, error: errors || `Python bridge exited ${code}` }))
          })
          res.on('close', () => { if (!ended) { clearTimeout(timer); child.kill() } })
          child.stdin.on('error', () => { /* child exit handler reports error */ })
          child.stdin.end(JSON.stringify(payload))
        })
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), localScientificBridge()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, host: '127.0.0.1' },
  preview: { port: 1420, strictPort: true, host: '127.0.0.1' },
})
