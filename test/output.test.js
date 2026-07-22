import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { createPrinter } from '../src/output.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const packageInfo = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))

test('uses terminal colors but respects NO_COLOR', () => {
  let colored = ''
  const colorPrinter = createPrinter({
    isTTY: true,
    write: (value) => { colored += value },
  }, {})
  colorPrinter.success('Ready')
  assert.match(colored, /\u001b\[32m/)

  let plain = ''
  const plainPrinter = createPrinter({
    isTTY: true,
    write: (value) => { plain += value },
  }, { NO_COLOR: '' })
  plainPrinter.success('Ready')
  assert.equal(plain, '✓ Ready\n')
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
