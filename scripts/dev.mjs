import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const useProcessGroups = process.platform !== 'win32'
const webPort = process.env.WEB_PORT || '5173'
const useSupabase = process.argv.includes('--supabase') || !!process.env.SUPABASE_DB_URL
const spawnOptions = { cwd: root, stdio: 'inherit', detached: useProcessGroups }
const children = [
  spawn(process.execPath, ['--watch', useSupabase ? 'server/supabase-local.mjs' : 'server/index.mjs'], spawnOptions),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', webPort, '--strictPort'], spawnOptions),
]
let stopping = false
let forceStopTimer

function signalChild(child, signal) {
  if (!child.pid) return
  try {
    if (useProcessGroups) process.kill(-child.pid, signal)
    else child.kill(signal)
  } catch (error) {
    if (error.code !== 'ESRCH') console.error(`Não foi possível encerrar o processo ${child.pid}: ${error.message}`)
  }
}

function stop(code = 0) {
  if (stopping) return
  stopping = true
  process.exitCode = code
  for (const child of children) signalChild(child, 'SIGTERM')
  forceStopTimer = setTimeout(() => {
    for (const child of children) signalChild(child, 'SIGKILL')
  }, 5500)
  forceStopTimer.unref()
}

process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())
process.on('exit', () => {
  // The watch supervisor may exit before its server child. Signal the group again.
  if (stopping) for (const child of children) signalChild(child, 'SIGTERM')
})
for (const child of children) {
  child.on('error', (error) => { console.error(error.message); stop(1) })
  child.on('exit', (code) => { if (!stopping) stop(code ?? 1) })
  child.on('close', () => {
    if (children.every((running) => running.exitCode !== null || running.signalCode !== null || !running.pid)) {
      clearTimeout(forceStopTimer)
    }
  })
}
