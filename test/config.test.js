import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { defaultConfig, loadConfig, purgeConfigDir, validateConfig } from '../src/config.js'

test('default config is conservative and valid', () => {
  const config = defaultConfig()
  assert.equal(config.mode, 'high-traffic-only')
  assert.equal(config.maxRetriesPerMinute, 20)
  assert.equal(config.autoContinue, false)
  assert.equal(validateConfig(config), config)
})

test('unsafe retry limits are rejected', () => {
  const config = { ...defaultConfig(), maxRetriesPerMinute: 121 }
  assert.throws(() => validateConfig(config), /between 1 and 120/)
})

test('loads config written by the native release', async (context) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'retrynaut-legacy-config-'))
  const file = path.join(dir, 'config.json')
  context.after(() => rm(dir, { recursive: true, force: true }))
  await writeFile(file, JSON.stringify({
    max_retries_per_minute: 18,
    mode: 'agent-errors',
    auto_continue: true,
    require_focus: true,
    retry_delay_ms: 700,
    scan_interval_ms: 300,
  }))
  assert.deepEqual(await loadConfig(file), {
    maxRetriesPerMinute: 18,
    mode: 'agent-errors',
    autoContinue: true,
    requireFocus: true,
    scanIntervalMs: 300,
  })
})

test('purge removes only a retrynaut directory', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'retrynaut-purge-'))
  const appDir = path.join(root, 'retrynaut')
  context.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(path.join(root, 'keep.txt'), 'keep')
  await mkdir(appDir)
  await writeFile(path.join(appDir, 'config.json'), '{}')
  await purgeConfigDir(appDir)
  await assert.rejects(access(appDir), { code: 'ENOENT' })
  await assert.rejects(purgeConfigDir(root), /refusing to purge/)
})
