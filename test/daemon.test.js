import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { runDaemon } from '../src/daemon.js'
import { appPaths } from '../src/paths.js'

test('closes its resources when startup fails', async (context) => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'retrynaut-daemon-'))
  context.after(() => rm(home, { recursive: true, force: true }))
  const paths = appPaths({ platform: 'linux', home, env: {} })
  const configFile = path.join(paths.configDir, 'broken.json')
  await mkdir(paths.configDir, { recursive: true })
  await writeFile(configFile, '{')

  await assert.rejects(
    runDaemon({ paths, configFile }),
    /could not read config/,
  )
  await assert.rejects(access(paths.controlEndpoint), { code: 'ENOENT' })
  await access(paths.logFile)
})
