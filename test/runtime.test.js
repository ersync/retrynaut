import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { appPaths } from '../src/paths.js'
import { installRuntime, loadRuntime } from '../src/runtime.js'

test('copies a stable runtime out of the npm package', async (context) => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'retrynaut-runtime-'))
  context.after(() => rm(home, { recursive: true, force: true }))
  const paths = appPaths({ platform: 'linux', home, env: {} })
  await installRuntime(paths, '/usr/bin/node')
  const runtime = await loadRuntime(paths)
  assert.equal(runtime.nodePath, '/usr/bin/node')
  assert.equal(runtime.cliPath, paths.runtimeCli)
  assert.equal(runtime.version, '0.1.0')
  assert.match(runtime.installedAt, /^\d{4}-\d{2}-\d{2}T/)
  await access(path.join(paths.runtimeDir, 'src', 'retry.js'))
  await access(paths.runtimeCli)
  const packageInfo = JSON.parse(await readFile(path.join(paths.runtimeDir, 'package.json'), 'utf8'))
  assert.equal(packageInfo.version, '0.1.0')
})
