import assert from 'node:assert/strict'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { runDaemon } from '../src/daemon.js'

test('releases its pid file when startup fails', async (context) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'retrynaut-daemon-'))
  context.after(() => rm(dir, { recursive: true, force: true }))
  const paths = { pidFile: path.join(dir, 'retrynaut.pid') }
  const configFile = path.join(dir, 'broken.json')
  await writeFile(configFile, '{')
  await assert.rejects(
    runDaemon({ paths, configFile }),
    /could not read config/,
  )
  await assert.rejects(access(paths.pidFile), { code: 'ENOENT' })
})
