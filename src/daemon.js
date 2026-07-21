import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { runController } from './cdp.js'
import { loadConfig } from './config.js'
import { findPort } from './discovery.js'
import { buildScript } from './inject.js'

export async function runDaemon({ paths, configFile, portFile, verbose = false }) {
  await claimPid(paths.pidFile)
  let stop
  try {
    const config = await loadConfig(configFile)
    const script = buildScript(config)
    const controller = new AbortController()
    stop = () => controller.abort()
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)

    console.log(`starting (mode=${config.mode}, max=${config.maxRetriesPerMinute}/min)`)
    await runController({
      findPort: () => findPort(portFile),
      script,
      signal: controller.signal,
      verbose,
    })
  } finally {
    if (stop) {
      process.removeListener('SIGINT', stop)
      process.removeListener('SIGTERM', stop)
    }
    await releasePid(paths.pidFile)
  }
}

export async function processIsRunning(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

export async function readPid(file) {
  try {
    const value = Number((await readFile(file, 'utf8')).trim())
    return Number.isInteger(value) && value > 0 ? value : undefined
  } catch (error) {
    if (error.code === 'ENOENT') return undefined
    throw error
  }
}

async function claimPid(file) {
  const existing = await readPid(file)
  if (existing && existing !== process.pid && await processIsRunning(existing)) {
    throw new Error(`Retrynaut is already running with pid ${existing}`)
  }
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, `${process.pid}\n`, { mode: 0o600 })
}

async function releasePid(file) {
  const current = await readPid(file)
  if (current === process.pid) await rm(file, { force: true })
}
