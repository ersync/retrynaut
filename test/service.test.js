import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createControlServer } from '../src/control.js'
import { appPaths } from '../src/paths.js'
import {
  renderLaunchAgent,
  renderSystemdUnit,
  renderWindowsTask,
  renderXdgEntry,
  serviceState,
  startService,
  stopService,
} from '../src/service.js'

const paths = {
  configFile: '/Users/a&b/Library/Application Support/retrynaut/config.json',
  logFile: '/Users/a&b/Library/Application Support/retrynaut/retrynaut.log',
}
const runtime = {
  nodePath: '/Users/a&b/.nvm/node%22',
  cliPath: '/Users/a&b/retrynaut/bin/retrynaut.js',
}

test('escapes LaunchAgent values', () => {
  const plist = renderLaunchAgent(paths, runtime)
  assert.match(plist, /a&amp;b/)
  assert.match(plist, /dev\.ersync\.retrynaut/)
})

test('renders Linux startup entries with the installed runtime', () => {
  const unit = renderSystemdUnit(paths, runtime)
  const desktop = renderXdgEntry(paths, runtime)
  assert.match(unit, /ExecStart="\/Users\/a&b\/\.nvm\/node%%22"/)
  assert.match(unit, /Restart=always/)
  assert.match(desktop, /Terminal=false/)
})

test('renders a least-privilege Windows task that restarts after failure', () => {
  const task = renderWindowsTask({ configFile: 'C:\\User & Data\\config.json' }, {
    nodePath: 'C:\\Program Files\\nodejs\\node.exe',
    cliPath: 'C:\\User & Data\\runtime\\bin\\retrynaut.js',
  }, 'WORKGROUP\\A&B')

  assert.match(task, /<RunLevel>LeastPrivilege<\/RunLevel>/)
  assert.match(task, /<Hidden>true<\/Hidden>/)
  assert.match(task, /<RestartOnFailure>[\s\S]*<Count>999<\/Count>/)
  assert.match(task, /WORKGROUP\\A&amp;B/)
  assert.match(task, /C:\\Program Files\\nodejs\\node\.exe/)
  assert.match(task, /C:\\User &amp; Data\\runtime\\bin/)
})

test('start succeeds without relaunching an already healthy agent', async (context) => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'retrynaut-start-'))
  context.after(() => rm(home, { recursive: true, force: true }))
  const nativePaths = testPaths(home)
  nativePaths.systemdUnit = path.join(home, 'systemd', 'retrynaut.service')
  nativePaths.xdgEntry = path.join(home, 'autostart', 'retrynaut.desktop')
  await mkdir(path.dirname(nativePaths.xdgEntry), { recursive: true })
  await writeFile(nativePaths.xdgEntry, '[Desktop Entry]\n')
  const control = await createControlServer(nativePaths, {
    status: () => ({ pid: 4242, startedAt: 'now' }),
  })
  context.after(() => control.close())

  const state = await startService(nativePaths, 'linux')
  assert.equal(state.installed, true)
  assert.equal(state.running, true)
  assert.equal(state.pid, 4242)
})

test('stop disables startup but keeps the installed runtime', async (context) => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'retrynaut-stop-'))
  context.after(() => rm(home, { recursive: true, force: true }))
  const nativePaths = testPaths(home)
  nativePaths.systemdUnit = path.join(home, 'systemd', 'retrynaut.service')
  nativePaths.xdgEntry = path.join(home, 'autostart', 'retrynaut.desktop')
  await mkdir(path.dirname(nativePaths.xdgEntry), { recursive: true })
  await writeFile(nativePaths.xdgEntry, '[Desktop Entry]\n')
  await mkdir(path.dirname(nativePaths.runtimeFile), { recursive: true })
  await writeFile(nativePaths.runtimeFile, '{}\n')
  let control
  control = await createControlServer(nativePaths, {
    status: () => ({ pid: 4242, startedAt: 'now' }),
    stop: () => {
      setImmediate(() => control.close())
      return { stopping: true }
    },
  })
  context.after(() => control.close())

  await stopService(nativePaths, 'linux')
  const state = await serviceState(nativePaths, 'linux')

  assert.equal(state.installed, true)
  assert.equal(state.startupEnabled, false)
  assert.equal(state.running, false)
  await assert.rejects(access(nativePaths.xdgEntry), { code: 'ENOENT' })
  await access(nativePaths.runtimeFile)
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
