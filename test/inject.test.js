import assert from 'node:assert/strict'
import test from 'node:test'

import { defaultConfig } from '../src/config.js'
import { buildScript } from '../src/inject.js'

test('embeds config into the retry controller', () => {
  const script = buildScript({ ...defaultConfig(), maxRetriesPerMinute: 17 })
  assert.doesNotMatch(script, /__RETRYNAUT_CONFIG__/)
  assert.match(script, /"maxRetriesPerMinute":17/)
  assert.match(script, /minimumClickIntervalMs = 500/)
  assert.doesNotMatch(script, /retryDelayMs/)
  assert.match(script, /text === 'retry' \|\| text === 'try again'/)
  assert.match(script, /previous\.start\?\.\(\)/)
})
