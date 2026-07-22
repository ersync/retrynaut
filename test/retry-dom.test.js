import assert from 'node:assert/strict'
import vm from 'node:vm'
import test from 'node:test'

import { defaultConfig } from '../src/config.js'
import { buildScript } from '../src/inject.js'

test('clicks an exact Retry button beside a high-traffic error', () => {
  const button = actionButton('Retry', 'Model unavailable due to high traffic Retry')
  const page = runPage([button])
  page.clock.tick(300)
  assert.equal(button.clicks, 1)
  assert.equal(page.reports.length, 1)
})

test('matches the current high-traffic article when the Retry panel is separate', () => {
  const button = actionButton('Retry', 'Agent terminated due to error Retry')
  const currentError = article('Our servers are experiencing high traffic right now')
  const page = runPage([button], {}, { clicks: [], tripped: false }, [currentError])
  page.clock.tick(300)
  assert.equal(button.clicks, 1)
})

test('does not use an old high-traffic article for a different current error', () => {
  const button = actionButton('Retry', 'Agent terminated due to error Retry')
  const oldError = article('High traffic', { top: -200, bottom: -100 })
  const currentError = article('Authentication failed')
  const page = runPage([button], {}, { clicks: [], tripped: false }, [oldError, currentError])
  page.clock.tick(700)
  assert.equal(button.clicks, 0)
})

test('ignores unrelated errors and inexact button labels', () => {
  const unrelated = actionButton('Retry', 'Authentication failed Retry')
  const inexact = actionButton('Retry now', 'High traffic Retry now')
  const page = runPage([unrelated, inexact])
  page.clock.tick(2_000)
  assert.equal(unrelated.clicks, 0)
  assert.equal(inexact.clicks, 0)
})

test('keeps broader agent errors opt-in', () => {
  const defaultButton = actionButton('Retry', 'Agent execution terminated due to error Retry')
  const defaultPage = runPage([defaultButton])
  defaultPage.clock.tick(700)
  assert.equal(defaultButton.clicks, 0)

  const optedInButton = actionButton('Retry', 'Agent execution terminated due to error Retry')
  const optedInPage = runPage([optedInButton], { mode: 'agent-errors' })
  optedInPage.clock.tick(300)
  assert.equal(optedInButton.clicks, 1)
})

test('replaces the active controller when configuration changes', () => {
  const button = actionButton('Retry', 'Agent execution terminated due to error Retry')
  const page = runPage([button])
  const first = page.context.retrynaut
  vm.runInNewContext(buildScript({ ...defaultConfig(), mode: 'agent-errors' }), page.context)
  page.clock.tick(300)
  assert.notEqual(page.context.retrynaut, first)
  assert.equal(first.status().running, false)
  assert.equal(button.clicks, 1)
})

test('cancels a pending click when stopped', () => {
  const button = actionButton('Retry', 'High traffic Retry')
  const page = runPage([button])
  page.clock.tick(50)
  page.context.retrynaut.stop()
  page.clock.tick(1_000)
  assert.equal(button.clicks, 0)
})

test('stops an orphaned controller when its daemon lease expires', () => {
  const page = runPage([])
  page.clock.tick(11_000)
  assert.equal(page.context.retrynaut.status().running, false)

  page.context.retrynaut.heartbeat()
  assert.equal(page.context.retrynaut.status().running, true)
})

test('does not undo an intentional stop when a heartbeat arrives', () => {
  const page = runPage([])
  page.context.retrynaut.stop()
  page.context.retrynaut.heartbeat()
  assert.equal(page.context.retrynaut.status().running, false)
})

test('retries in a burst instead of pacing clicks across the minute', () => {
  const button = actionButton('Retry', 'High traffic Retry')
  const page = runPage([button], {
    maxRetriesPerMinute: 20,
    scanIntervalMs: 100,
  })
  page.clock.setInterval(() => page.context.retrynaut.heartbeat(), 3_000)
  page.clock.tick(1_800)
  assert.ok(button.clicks >= 3)
  assert.equal(page.context.retrynaut.status().tripped, false)
})

test('trips at the rolling click limit and resumes after the window clears', () => {
  const button = actionButton('Retry', 'High traffic Retry')
  const page = runPage([button], {
    maxRetriesPerMinute: 3,
    scanIntervalMs: 100,
  })
  page.clock.tick(2_000)
  assert.equal(button.clicks, 3)
  assert.equal(page.context.retrynaut.status().tripped, true)
  assert.equal(page.context.retrynaut.status().running, false)

  page.clock.tick(60_000)
  page.context.retrynaut.heartbeat()
  page.clock.tick(700)
  assert.ok(button.clicks > 3)
  assert.equal(page.context.retrynaut.status().tripped, false)
})

test('carries a tripped circuit breaker into a fresh context', () => {
  const seededButton = actionButton('Retry', 'High traffic Retry')
  const seeded = runPage([seededButton], {
    maxRetriesPerMinute: 3,
    scanIntervalMs: 100,
  }, {
    clicks: Array.from({ length: 3 }, (_, index) => 999_000 + index),
    tripped: true,
  })
  seeded.clock.tick(2_000)
  assert.equal(seededButton.clicks, 0)
  assert.equal(seeded.context.retrynaut.status().tripped, true)
})

function actionButton(label, contextText) {
  const parent = element(contextText)
  const button = element(label, parent)
  button.clicks = 0
  button.click = () => {
    button.clicks += 1
  }
  return button
}

function element(textContent, parentElement) {
  return {
    textContent,
    parentElement,
    isConnected: true,
    disabled: false,
    getAttribute: () => null,
    getClientRects: () => [1],
  }
}

function article(textContent, rect = {}) {
  const node = element(textContent)
  node.getBoundingClientRect = () => ({
    top: 100,
    bottom: 200,
    left: 100,
    right: 200,
    ...rect,
  })
  return node
}

function runPage(buttons, configOverrides = {}, seed = { clicks: [], tripped: false }, articles = []) {
  const clock = fakeClock()
  const reports = []
  const body = element('')
  const documentElement = element('')
  for (const button of buttons) {
    let root = button
    while (root.parentElement) root = root.parentElement
    root.parentElement = body
  }
  class MutationObserver {
    observe() {}
    disconnect() {}
  }
  const context = {
    __retrynautStateSeed: structuredClone(seed),
    __retrynautReportClick: (value) => reports.push(Number(value)),
    console: { info() {}, warn() {} },
    Date: clock.Date,
    document: {
      body,
      documentElement,
      hasFocus: () => true,
      querySelectorAll: (selector) => selector === '[role="article"]' ? articles : buttons,
    },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    innerHeight: 1_000,
    innerWidth: 1_000,
    MutationObserver,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clear,
    setInterval: clock.setInterval,
    clearInterval: clock.clear,
  }
  const config = { ...defaultConfig(), ...configOverrides }
  vm.runInNewContext(buildScript(config), context)
  return { clock, context, reports }
}

function fakeClock() {
  let now = 1_000_000
  let nextId = 1
  const tasks = new Map()
  const cancelled = new Set()

  const schedule = (callback, wait = 0, interval = 0) => {
    const id = nextId++
    tasks.set(id, { callback, due: now + Number(wait), interval })
    return id
  }
  const setTimeout = (callback, wait) => schedule(callback, wait)
  const setInterval = (callback, wait) => schedule(callback, wait, Number(wait))
  const clear = (id) => {
    cancelled.add(id)
    tasks.delete(id)
  }
  const tick = (milliseconds) => {
    const target = now + milliseconds
    while (true) {
      let selected
      for (const [id, task] of tasks) {
        if (task.due > target) continue
        if (!selected || task.due < selected.task.due
            || (task.due === selected.task.due && id < selected.id)) {
          selected = { id, task }
        }
      }
      if (!selected) break
      tasks.delete(selected.id)
      now = selected.task.due
      selected.task.callback()
      if (selected.task.interval && !cancelled.has(selected.id)) {
        selected.task.due = now + selected.task.interval
        tasks.set(selected.id, selected.task)
      }
    }
    now = target
  }
  class FakeDate extends Date {
    static now() {
      return now
    }
  }
  return { Date: FakeDate, clear, setInterval, setTimeout, tick }
}
