import assert from 'node:assert/strict'
import test from 'node:test'

import { createClickBudget, isAntigravityPage } from '../src/cdp.js'

test('accepts only local Antigravity page targets', () => {
  assert.equal(isAntigravityPage({
    type: 'page',
    url: 'https://127.0.0.1:43123/',
    webSocketDebuggerUrl: 'ws://127.0.0.1:43000/devtools/page/1',
  }), true)
  assert.equal(isAntigravityPage({
    type: 'page',
    url: 'https://example.com/',
    webSocketDebuggerUrl: 'ws://127.0.0.1:43000/devtools/page/2',
  }), false)
  assert.equal(isAntigravityPage({
    type: 'worker',
    url: 'https://127.0.0.1:43123/',
    webSocketDebuggerUrl: 'ws://127.0.0.1:43000/devtools/page/3',
  }), false)
})

test('releases the click breaker when its rolling window clears', () => {
  const now = Date.now()
  const budget = createClickBudget(3)
  budget.record(now - 2)
  budget.record(now - 1)
  budget.record(now)

  assert.deepEqual(budget.status(now), {
    tripped: true,
    clicksLastMinute: 3,
    limit: 3,
  })
  assert.deepEqual(budget.status(now + 60_001), {
    tripped: false,
    clicksLastMinute: 0,
    limit: 3,
  })
  assert.deepEqual(budget.snapshot(now + 60_001), { clicks: [], tripped: false })
})
