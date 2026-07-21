import assert from 'node:assert/strict'
import test from 'node:test'

import { appPaths } from '../src/paths.js'

test('uses native config locations', () => {
  assert.equal(
    appPaths({ platform: 'darwin', home: '/Users/test', env: {} }).configDir,
    '/Users/test/Library/Application Support/retrynaut',
  )
  assert.match(
    appPaths({ platform: 'win32', home: 'C:\\Users\\test', env: { APPDATA: 'C:\\AppData' } }).configDir,
    /retrynaut$/,
  )
  assert.equal(
    appPaths({ platform: 'linux', home: '/home/test', env: {} }).configDir,
    '/home/test/.config/retrynaut',
  )
})
