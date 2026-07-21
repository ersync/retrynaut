import { setTimeout as delay } from 'node:timers/promises'

export async function listTargets(port, signal) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
    signal: combinedSignal(signal, 3_000),
  })
  if (!response.ok) throw new Error(`CDP returned ${response.status} ${response.statusText}`)
  return response.json()
}

export function isAntigravityPage(target) {
  if (target.type !== 'page' || !target.webSocketDebuggerUrl) return false
  try {
    const page = new URL(target.url)
    return page.protocol === 'https:'
      && (page.hostname === '127.0.0.1' || page.hostname === 'localhost')
  } catch {
    return false
  }
}

export async function runController({ findPort, script, signal, logger = console, verbose = false }) {
  let active
  const clickBudget = createClickBudget()

  while (!signal.aborted) {
    try {
      const { port } = await findPort()
      const targets = await listTargets(port, signal)
      const target = targets.find(isAntigravityPage)
      if (target && !active) {
        const promise = holdSession(target, script, clickBudget, signal, () => {
          logger.log(`attached to Antigravity page ${target.id}`)
        }).catch((error) => {
          if (verbose && !signal.aborted) logger.log(`target ${target.id} disconnected: ${error.message}`)
        }).finally(() => {
          if (active?.id === target.id) active = undefined
        })
        active = { id: target.id, promise }
      }
    } catch (error) {
      if (verbose && !signal.aborted) logger.log(`waiting for Antigravity: ${error.message}`)
    }

    try {
      await delay(2_000, undefined, { signal })
    } catch {
      break
    }
  }

  if (active) await Promise.allSettled([active.promise])
}

export async function queryStatus(target, signal) {
  const session = await CDPSession.connect(target.webSocketDebuggerUrl, signal)
  try {
    const result = await evaluate(session, {
      expression: 'globalThis.retrynaut?.status?.() ?? null',
      returnByValue: true,
    })
    const value = result?.result?.value
    if (value == null) throw new Error('retry controller is not active')
    return value
  } finally {
    session.close()
  }
}

export async function pauseControllers(port, signal) {
  const targets = await listTargets(port, signal)
  let paused = 0
  for (const target of targets) {
    if (!isAntigravityPage(target)) continue
    let session
    try {
      session = await CDPSession.connect(target.webSocketDebuggerUrl, signal)
      await evaluate(session, { expression: 'globalThis.retrynaut?.stop?.()' })
      paused += 1
    } catch {
      // A page can disappear while Antigravity is reloading.
    } finally {
      session?.close()
    }
  }
  return paused
}

async function holdSession(target, script, clickBudget, signal, ready) {
  const session = await CDPSession.connect(target.webSocketDebuggerUrl)
  let mainFrameId
  let mainContextId
  let onAbort = () => {}
  const contexts = new Map()
  const injections = new Set()

  const inject = (contextId) => {
    let injection
    injection = (async () => {
      const existing = await evaluate(session, {
        expression: 'globalThis.retrynaut?.history?.() ?? []',
        returnByValue: true,
        ...(contextId ? { contextId } : {}),
      })
      clickBudget.merge(existing?.result?.value)
      const seed = JSON.stringify(clickBudget.snapshot())
      await evaluate(session, {
        expression: `globalThis.__retrynautClickSeed=${seed};\n${script}`,
        ...(contextId ? { contextId } : {}),
      })
    })().finally(() => injections.delete(injection))
    injections.add(injection)
    return injection
  }

  const removeContextListener = session.on('Runtime.executionContextDestroyed', ({ executionContextId }) => {
    for (const [frameId, contextId] of contexts) {
      if (contextId === executionContextId) contexts.delete(frameId)
    }
    if (mainContextId === executionContextId) mainContextId = undefined
  })
  const createContextListener = session.on('Runtime.executionContextCreated', ({ context }) => {
    const frameId = context.auxData?.frameId
    if (!frameId || !context.auxData?.isDefault) return
    contexts.set(frameId, context.id)
    if (frameId === mainFrameId) {
      mainContextId = context.id
      inject(context.id).catch(() => session.close())
    }
  })
  const frameListener = session.on('Page.frameNavigated', ({ frame }) => {
    if (frame.parentId) return
    mainFrameId = frame.id
    mainContextId = contexts.get(frame.id)
    if (mainContextId) inject(mainContextId).catch(() => session.close())
  })
  const clearContextsListener = session.on('Runtime.executionContextsCleared', () => {
    contexts.clear()
    mainContextId = undefined
  })
  const bindingListener = session.on('Runtime.bindingCalled', ({ name, payload, executionContextId }) => {
    if (name === '__retrynautReportClick'
        && (!mainContextId || executionContextId === mainContextId)) {
      clickBudget.record(Number(payload))
    }
  })

  try {
    await session.call('Page.enable')
    await session.call('Runtime.enable')
    await session.call('Runtime.addBinding', { name: '__retrynautReportClick' })
    const tree = await session.call('Page.getFrameTree')
    mainFrameId = tree.frameTree.frame.id
    mainContextId = contexts.get(mainFrameId)
    await inject(mainContextId)
    ready()

    const heartbeat = keepAlive(session, signal, () => mainContextId)
    let resolveAbort
    onAbort = () => resolveAbort('aborted')
    const aborted = new Promise((resolve) => {
      resolveAbort = resolve
      if (signal.aborted) resolve('aborted')
      else signal.addEventListener('abort', onAbort, { once: true })
    })
    const outcome = await Promise.race([
      session.waitForClose().then(() => 'closed'),
      heartbeat.then(
        () => 'heartbeat-ended',
        (error) => {
          if (signal.aborted) return 'aborted'
          throw error
        },
      ),
      aborted,
    ])
    if (outcome === 'aborted') {
      try {
        await evaluate(session, {
          expression: 'globalThis.retrynaut?.stop?.()',
          ...(mainContextId ? { contextId: mainContextId } : {}),
        })
      } catch {
        // The page may already be closing.
      }
    }
  } finally {
    signal.removeEventListener('abort', onAbort)
    removeContextListener()
    createContextListener()
    frameListener()
    clearContextsListener()
    bindingListener()
    await Promise.allSettled(injections)
    session.close()
  }
}

function createClickBudget() {
  const clicks = []
  const known = new Set()
  const prune = (now = Date.now()) => {
    const cutoff = now - 60_000
    while (clicks.length && clicks[0] <= cutoff) known.delete(clicks.shift())
  }
  return {
    record(now = Date.now()) {
      const current = Date.now()
      prune(current)
      if (!Number.isFinite(now) || now <= current - 60_000 || now > current + 5_000
          || known.has(now)) return
      known.add(now)
      clicks.push(now)
      clicks.sort((left, right) => left - right)
    },
    merge(values) {
      if (!Array.isArray(values)) return
      for (const value of values) this.record(value)
    },
    snapshot(now = Date.now()) {
      prune(now)
      return [...clicks]
    },
  }
}

async function keepAlive(session, signal, contextId) {
  while (!signal.aborted) {
    await delay(3_000, undefined, { signal })
    await evaluate(session, {
      expression: 'globalThis.retrynaut?.heartbeat?.()',
      ...(contextId() ? { contextId: contextId() } : {}),
    })
  }
}

async function evaluate(session, params) {
  const result = await session.call('Runtime.evaluate', params)
  if (result?.exceptionDetails) {
    const message = result.exceptionDetails.exception?.description
      || result.exceptionDetails.text
      || 'JavaScript evaluation failed'
    throw new Error(message)
  }
  return result
}

class CDPSession {
  constructor(socket, signal) {
    this.socket = socket
    this.nextId = 1
    this.pending = new Map()
    this.closed = new Promise((resolve) => {
      this.resolveClosed = resolve
    })

    socket.addEventListener('message', (event) => this.onMessage(event.data))
    socket.addEventListener('close', () => this.onClose(new Error('CDP socket closed')))
    socket.addEventListener('error', () => this.onClose(new Error('CDP socket error')))

    if (signal) {
      this.abort = () => this.close()
      signal.addEventListener('abort', this.abort, { once: true })
      this.signal = signal
    }
  }

  static async connect(rawUrl, signal) {
    const url = new URL(rawUrl)
    if (url.protocol !== 'ws:'
        || (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost')) {
      throw new Error(`refusing non-local WebSocket URL: ${rawUrl}`)
    }
    if (signal?.aborted) throw signal.reason || new Error('operation aborted')

    const socket = new WebSocket(url)
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.close()
        reject(new Error('CDP connection timed out'))
      }, 5_000)
      socket.addEventListener('open', () => {
        clearTimeout(timer)
        resolve()
      }, { once: true })
      socket.addEventListener('error', () => {
        clearTimeout(timer)
        reject(new Error('could not connect to CDP'))
      }, { once: true })
    })
    return new CDPSession(socket, signal)
  }

  call(method, params) {
    if (this.didClose || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('CDP session is closed'))
    }
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} timed out`))
      }, 5_000)
      this.pending.set(id, { method, resolve, reject, timer })
      this.socket.send(JSON.stringify({ id, method, ...(params ? { params } : {}) }))
    })
  }

  waitForClose() {
    return this.closed
  }

  on(method, listener) {
    if (!this.listeners) this.listeners = new Map()
    if (!this.listeners.has(method)) this.listeners.set(method, new Set())
    this.listeners.get(method).add(listener)
    return () => this.listeners.get(method)?.delete(listener)
  }

  close() {
    this.signal?.removeEventListener('abort', this.abort)
    if (this.socket.readyState < WebSocket.CLOSING) this.socket.close()
    this.onClose(new Error('CDP session closed'))
  }

  onMessage(data) {
    let message
    try {
      message = JSON.parse(typeof data === 'string' ? data : Buffer.from(data).toString('utf8'))
    } catch {
      return
    }
    if (!message.id) {
      for (const listener of this.listeners?.get(message.method) || []) {
        try {
          listener(message.params || {})
        } catch {
          // Event listeners cannot break the CDP message loop.
        }
      }
      return
    }
    if (!this.pending.has(message.id)) return
    const pending = this.pending.get(message.id)
    this.pending.delete(message.id)
    clearTimeout(pending.timer)
    if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`))
    else pending.resolve(message.result)
  }

  onClose(error) {
    if (this.didClose) return
    this.didClose = true
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
    this.resolveClosed()
  }
}

function combinedSignal(signal, timeout) {
  const timeoutSignal = AbortSignal.timeout(timeout)
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
}
