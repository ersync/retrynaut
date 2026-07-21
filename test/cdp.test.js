import assert from 'node:assert/strict'
import test from 'node:test'

import { isAntigravityPage } from '../src/cdp.js'

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
