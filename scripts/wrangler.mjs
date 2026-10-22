import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const local = join(root, '.wrangler')
for (const name of ['config', 'cache', 'logs']) mkdirSync(join(local, name), { recursive: true })
const child = spawn(process.execPath, [join(root, 'node_modules/wrangler/bin/wrangler.js'), ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    CI: process.env.CI || '1',
    WRANGLER_SEND_METRICS: 'false',
    XDG_CONFIG_HOME: join(local, 'config'),
    XDG_CACHE_HOME: join(local, 'cache'),
    WRANGLER_LOG_PATH: join(local, 'logs/wrangler.log'),
  },
})
child.on('error', (error) => { console.error(error.message); process.exitCode = 1 })
child.on('exit', (code) => { process.exitCode = code ?? 1 })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
