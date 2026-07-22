import assert from 'node:assert/strict'
import { access, mkdtemp, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  agentStatus,
  createControlServer,
  requestControl,
  stopAgent,
} from '../src/control.js'
import { appPaths } from '../src/paths.js'

test('uses an authenticated local endpoint for status and shutdown', async (context) => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'retrynaut-control-'))
  context.after(() => rm(home, { recursive: true, force: true }))
  const paths = testPaths(home)
  let stopping = false
  let server
  server = await createControlServer(paths, {
    status: () => ({ pid: 4242, startedAt: 'now' }),
    stop: () => {
      stopping = true
      setImmediate(() => server.close())
      return { stopping: true }
    },
  })
  context.after(() => server.close())

  assert.deepEqual(await agentStatus(paths), { pid: 4242, startedAt: 'now' })
  if (process.platform !== 'win32') {
    assert.equal((await stat(paths.controlKeyFile)).mode & 0o777, 0o600)
    assert.equal((await stat(paths.controlEndpoint)).mode & 0o777, 0o600)
  }
  await assert.rejects(
    createControlServer(paths, { status: () => ({}) }),
    /already running/,
  )
  assert.equal(await stopAgent(paths), true)
  assert.equal(stopping, true)
  if (process.platform === 'win32') {
    assert.equal(await agentStatus(paths), undefined)
  } else {
    await assert.rejects(access(paths.controlEndpoint), { code: 'ENOENT' })
  }
})

function testEnv(home) {
  return {
    APPDATA: path.join(home, 'AppData', 'Roaming'),
    XDG_CONFIG_HOME: path.join(home, '.config'),
  }
}

function testPaths(home) {
  const paths = appPaths({ platform: process.platform, home, env: testEnv(home) })
  if (process.platform !== 'win32') {
    paths.controlEndpoint = path.join(home, 'control.sock')
    paths.controlKeyFile = path.join(home, 'control.key')
  }
  return paths
}
