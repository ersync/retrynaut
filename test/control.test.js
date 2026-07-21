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
  const paths = appPaths({ platform: 'linux', home, env: {} })
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
  assert.equal((await stat(paths.controlKeyFile)).mode & 0o777, 0o600)
  assert.equal((await stat(paths.controlEndpoint)).mode & 0o777, 0o600)
  await assert.rejects(
    createControlServer(paths, { status: () => ({}) }),
    /already running/,
  )
  assert.equal(await stopAgent(paths), true)
  assert.equal(stopping, true)
  await assert.rejects(access(paths.controlEndpoint), { code: 'ENOENT' })
})
