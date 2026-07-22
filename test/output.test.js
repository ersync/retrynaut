import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { createPrinter } from '../src/output.js'
import { buildStatus, printStatus } from '../src/presentation.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const packageInfo = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))

test('uses terminal colors but respects NO_COLOR', () => {
  let colored = ''
  const colorPrinter = createPrinter({
    isTTY: true,
    write: (value) => { colored += value },
  }, {})
  colorPrinter.line(colorPrinter.green('Ready'))
  assert.match(colored, /\u001b\[32m/)

  let plain = ''
  const plainPrinter = createPrinter({
    isTTY: true,
    write: (value) => { plain += value },
  }, { NO_COLOR: '' })
  plainPrinter.line(plainPrinter.green('Ready'))
  assert.equal(plain, 'Ready\n')
})

test('status offers machine-readable JSON', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'retrynaut-status-'))
  try {
    const result = spawnSync(process.execPath, ['bin/retrynaut.js', 'status', '--json'], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        APPDATA: path.join(home, 'AppData', 'Roaming'),
        HOME: home,
        LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
        NO_COLOR: '1',
        USERPROFILE: home,
        XDG_CONFIG_HOME: path.join(home, '.config'),
      },
    })
    assert.equal(result.status, 0, result.stderr)
    const status = JSON.parse(result.stdout)
    assert.equal(status.cliVersion, packageInfo.version)
    assert.equal(status.agent.installed, false)
    assert.equal(status.activity, null)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('status reports a daemon-wide retry limit', () => {
  const status = buildStatus({
    config: {
      mode: 'high-traffic-only',
      maxRetriesPerMinute: 20,
      requireFocus: false,
    },
    controller: null,
    pageCount: 0,
    paths: {},
    runtime: null,
    runtimeError: null,
    state: {
      installed: true,
      startupEnabled: true,
      running: true,
      pid: 4242,
      retry: { tripped: true, clicksLastMinute: 0, limit: 20 },
    },
  }, '0.1.1')

  assert.deepEqual(status.retryLimit, {
    reached: true,
    clicksLastMinute: 0,
    limit: 20,
  })
})

test('default status stays compact', () => {
  const status = buildStatus({
    config: {
      mode: 'high-traffic-only',
      maxRetriesPerMinute: 20,
      requireFocus: false,
    },
    controller: {
      version: 6,
      running: true,
      tripped: false,
      mode: 'high-traffic-only',
      retryClicks: 1,
      clicksLastMinute: 1,
      maxRetriesPerMinute: 20,
      scanCount: 10,
      minimumClickIntervalMs: 500,
      leaseUntil: Date.parse('2026-07-22T12:00:00Z'),
    },
    pageCount: 1,
    paths: {
      runtimeDir: '/runtime',
      registration: '/startup',
    },
    runtime: {
      version: '0.1.1',
      installedAt: '2026-07-22T12:00:00Z',
      nodePath: '/node',
    },
    runtimeError: null,
    state: {
      installed: true,
      startupEnabled: true,
      running: true,
      pid: 56343,
    },
  }, '0.1.1')
  let text = ''
  const printer = createPrinter({
    isTTY: false,
    write: (value) => { text += value },
  }, { NO_COLOR: '1' })

  printStatus(status, false, printer)

  assert.match(text, /^Retrynaut 0\.1\.1\n\n/)
  assert.match(text, /Automatic retry  On\n/)
  assert.match(text, /Antigravity      Connected\n/)
  assert.match(text, /Mode             High traffic only\n$/)
  assert.doesNotMatch(text, /Retries|PID|Node|Controller|Runtime|Startup/)

  let verboseText = ''
  const verbosePrinter = createPrinter({
    isTTY: false,
    write: (value) => { verboseText += value },
  }, { NO_COLOR: '1' })

  printStatus(status, true, verbosePrinter)

  assert.match(verboseText, /Retries          1 this session · 1\/20 last minute\n/)
})

test('stopped status only reports that automatic retry is off', () => {
  const status = buildStatus({
    config: {
      mode: 'high-traffic-only',
      maxRetriesPerMinute: 20,
      requireFocus: false,
    },
    controller: null,
    pageCount: 0,
    paths: {
      runtimeDir: '/runtime',
      registration: '/startup',
    },
    runtime: {
      version: '0.1.1',
      installedAt: '2026-07-22T12:00:00Z',
      nodePath: '/node',
    },
    runtimeError: null,
    state: {
      installed: true,
      startupEnabled: false,
      running: false,
      pid: null,
      retry: null,
    },
  }, '0.1.1')
  let text = ''
  const printer = createPrinter({
    isTTY: false,
    write: (value) => { text += value },
  }, { NO_COLOR: '1' })

  printStatus(status, false, printer)

  assert.equal(text, 'Retrynaut 0.1.1\n\nAutomatic retry  Off\n')
})
