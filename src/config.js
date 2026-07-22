export const modes = new Set(['all', 'agent-errors', 'high-traffic-only'])

export function defaultConfig() {
  return {
    maxRetriesPerMinute: 20,
    mode: 'high-traffic-only',
    requireFocus: false,
    scanIntervalMs: 250,
  }
}

export function validateConfig(config) {
  if (!Number.isInteger(config.maxRetriesPerMinute)
      || config.maxRetriesPerMinute < 1
      || config.maxRetriesPerMinute > 120) {
    throw new Error('maxRetriesPerMinute must be an integer between 1 and 120')
  }
  if (!modes.has(config.mode)) {
    throw new Error(`unknown retry mode: ${config.mode}`)
  }
  if (!Number.isInteger(config.scanIntervalMs)
      || config.scanIntervalMs < 100
      || config.scanIntervalMs > 60_000) {
    throw new Error('scanIntervalMs must be an integer between 100 and 60000')
  }
  return config
}

export async function loadConfig(file) {
  let stored = {}
  try {
    stored = JSON.parse(await readFile(file, 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`could not read config: ${error.message}`)
  }
  const defaults = defaultConfig()
  const config = {
    maxRetriesPerMinute: stored.maxRetriesPerMinute
      ?? stored.max_retries_per_minute
      ?? defaults.maxRetriesPerMinute,
    mode: stored.mode ?? defaults.mode,
    requireFocus: stored.requireFocus ?? stored.require_focus ?? defaults.requireFocus,
    scanIntervalMs: stored.scanIntervalMs ?? stored.scan_interval_ms ?? defaults.scanIntervalMs,
  }
  return validateConfig(config)
}

export async function saveConfig(file, config) {
  validateConfig(config)
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, file)
}

export async function purgeConfigDir(dir) {
  const resolved = path.resolve(dir)
  if (path.basename(resolved) !== 'retrynaut') {
    throw new Error(`refusing to purge unexpected directory: ${resolved}`)
  }
  await rm(resolved, { recursive: true, force: true })
}
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
