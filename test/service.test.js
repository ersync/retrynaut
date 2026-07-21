import assert from 'node:assert/strict'
import test from 'node:test'

import {
  renderLaunchAgent,
  renderScheduledCommand,
  renderSystemdUnit,
  renderXdgEntry,
} from '../src/service.js'

const paths = {
  configFile: '/Users/a&b/Library/Application Support/retrynaut/config.json',
  logFile: '/Users/a&b/Library/Application Support/retrynaut/retrynaut.log',
}
const runtime = {
  nodePath: '/Users/a&b/.nvm/node',
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
  assert.match(unit, /ExecStart="\/Users\/a&b\/\.nvm\/node"/)
  assert.match(desktop, /Terminal=false/)
})

test('quotes every Windows task argument', () => {
  const command = renderScheduledCommand({ configFile: 'C:\\User Data\\config.json' }, {
    nodePath: 'C:\\Program Files\\nodejs\\node.exe',
    cliPath: 'C:\\User Data\\retrynaut.js',
  })
  assert.equal(
    command,
    '"C:\\Program Files\\nodejs\\node.exe" "C:\\User Data\\retrynaut.js" "run" "--config" "C:\\User Data\\config.json"',
  )
})
