import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

test('doctor explains when Antigravity is unavailable', async (context) => {
  const userData = await mkdtemp(path.join(os.tmpdir(), 'retrynaut-doctor-'))
  context.after(() => rm(userData, { recursive: true, force: true }))

  const result = runDoctor(userData)

  assert.equal(result.status, 1)
  assert.equal(result.stderr, [
    'Cannot find Antigravity.',
    '',
    'Make sure it is open, then try again.',
    '',
  ].join('\n'))
  assert.doesNotMatch(result.stderr, /fetch failed|DevToolsActivePort/)
})

test('doctor verbose output includes the local connection error', async (context) => {
  const userData = await mkdtemp(path.join(os.tmpdir(), 'retrynaut-doctor-'))
  context.after(() => rm(userData, { recursive: true, force: true }))
  const port = await unusedPort()
  await writeFile(path.join(userData, 'DevToolsActivePort'), `${port}\n`)

  const result = runDoctor(userData, '--verbose')

  assert.equal(result.status, 1)
  assert.match(result.stderr, /Cannot find Antigravity\./)
  assert.match(result.stderr, new RegExp(`Details\\n  connect ECONNREFUSED 127\\.0\\.0\\.1:${port}`))
  assert.match(result.stderr, new RegExp(`Port: ${port}`))
  assert.match(result.stderr, /Port file: .*DevToolsActivePort/)
})

function runDoctor(userData, ...args) {
  return spawnSync(process.execPath, ['bin/retrynaut.js', 'doctor', ...args], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      ANTIGRAVITY_USER_DATA_DIR: userData,
      NO_COLOR: '1',
    },
  })
}

function unusedPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close((error) => error ? reject(error) : resolve(port))
    })
  })
}
