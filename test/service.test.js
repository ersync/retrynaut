import assert from 'node:assert/strict'
import test from 'node:test'

import {
  renderLaunchAgent,
  renderSystemdUnit,
  renderWindowsTask,
  renderXdgEntry,
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
