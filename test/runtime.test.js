import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { appPaths } from '../src/paths.js'
import { installRuntime, loadRuntime, removeRuntime } from '../src/runtime.js'

const sourcePackage = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

test('copies a stable runtime out of the npm package', async (context) => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'retrynaut-runtime-'))
  context.after(() => rm(home, { recursive: true, force: true }))
  const paths = appPaths({ platform: process.platform, home, env: testEnv(home) })
  await installRuntime(paths, '/usr/bin/node')
  const runtime = await loadRuntime(paths)
  assert.equal(runtime.nodePath, '/usr/bin/node')
  assert.equal(runtime.cliPath, paths.runtimeCli)
  assert.equal(runtime.version, sourcePackage.version)
  assert.match(runtime.installedAt, /^\d{4}-\d{2}-\d{2}T/)
  await access(path.join(paths.runtimeDir, 'src', 'retry.js'))
  await access(paths.runtimeCli)
  const installedPackage = JSON.parse(
    await readFile(path.join(paths.runtimeDir, 'package.json'), 'utf8'),
  )
  assert.equal(installedPackage.version, sourcePackage.version)
})

test('removes the runtime without deleting config or logs', async (context) => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'retrynaut-remove-runtime-'))
  context.after(() => rm(home, { recursive: true, force: true }))
  const paths = appPaths({ platform: process.platform, home, env: testEnv(home) })
  await installRuntime(paths, '/usr/bin/node')
  await writeFile(paths.configFile, '{}\n')
  await writeFile(paths.logFile, 'log\n')

  await removeRuntime(paths)

  await assert.rejects(access(paths.runtimeDir), { code: 'ENOENT' })
  await assert.rejects(access(paths.runtimeFile), { code: 'ENOENT' })
  await access(paths.configFile)
  await access(paths.logFile)
})

function testEnv(home) {
  return {
    APPDATA: path.join(home, 'AppData', 'Roaming'),
    XDG_CONFIG_HOME: path.join(home, '.config'),
  }
}
