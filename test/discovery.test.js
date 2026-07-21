import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { readPort } from '../src/discovery.js'

test('reads the first line of DevToolsActivePort', async (context) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'retrynaut-port-'))
  const file = path.join(dir, 'DevToolsActivePort')
  await writeFile(file, '43123\n/devtools/browser/example\n')
  context.after(() => rm(dir, { recursive: true, force: true }))
  assert.equal(await readPort(file), 43123)
})

test('rejects malformed ports', async (context) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'retrynaut-bad-port-'))
  const file = path.join(dir, 'DevToolsActivePort')
  await writeFile(file, 'nope\n')
  context.after(() => rm(dir, { recursive: true, force: true }))
  await assert.rejects(readPort(file), /invalid debugging port/)
})
