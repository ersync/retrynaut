import assert from 'node:assert/strict'
import test from 'node:test'

import { defaultConfig, validateConfig } from '../src/config.js'

test('default config is conservative and valid', () => {
  const config = defaultConfig()
  assert.equal(config.mode, 'high-traffic-only')
  assert.equal(config.maxRetriesPerMinute, 20)
  assert.equal(config.autoContinue, false)
  assert.equal(validateConfig(config), config)
})

test('unsafe retry limits are rejected', () => {
  const config = { ...defaultConfig(), maxRetriesPerMinute: 121 }
  assert.throws(() => validateConfig(config), /between 1 and 120/)
})
