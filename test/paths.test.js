import assert from 'node:assert/strict'
import test from 'node:test'

import { appPaths } from '../src/paths.js'

test('uses native config locations', () => {
  const mac = appPaths({ platform: 'darwin', home: '/Users/test', env: {} })
  assert.equal(
    mac.configDir,
    '/Users/test/Library/Application Support/retrynaut',
  )
  assert.equal(mac.controlEndpoint, `${mac.configDir}/control.sock`)
  assert.equal(
    appPaths({ platform: 'win32', home: 'C:\\Users\\test', env: { APPDATA: 'C:\\AppData' } }).configDir,
    'C:\\AppData\\retrynaut',
  )
  assert.equal(
    appPaths({ platform: 'linux', home: '/home/test', env: {} }).configDir,
    '/home/test/.config/retrynaut',
  )
  assert.match(
    appPaths({ platform: 'win32', home: 'C:\\Users\\test', env: { APPDATA: 'C:\\AppData' } })
      .controlEndpoint,
    /^\\\\\.\\pipe\\retrynaut-[0-9a-f]{12}$/,
  )
})
