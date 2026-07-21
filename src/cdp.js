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
  const active = new Map()

  while (!signal.aborted) {
    try {
      const { port } = await findPort()
      const targets = await listTargets(port, signal)
      for (const target of targets) {
        if (!isAntigravityPage(target) || active.has(target.id)) continue
        const session = holdSession(target, script, signal, () => {
          logger.log(`attached to Antigravity page ${target.id}`)
        }).catch((error) => {
          if (verbose && !signal.aborted) logger.log(`target ${target.id} disconnected: ${error.message}`)
        }).finally(() => active.delete(target.id))
        active.set(target.id, session)
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

  await Promise.allSettled(active.values())
}

export async function queryStatus(target, signal) {
  const session = await CDPSession.connect(target.webSocketDebuggerUrl, signal)
  try {
    const result = await session.call('Runtime.evaluate', {
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
    try {
      const session = await CDPSession.connect(target.webSocketDebuggerUrl, signal)
      await session.call('Runtime.evaluate', { expression: 'globalThis.retrynaut?.stop?.()' })
      session.close()
      paused += 1
    } catch {
      // A page can disappear while Antigravity is reloading.
    }
  }
  return paused
}

async function holdSession(target, script, signal, ready) {
  const session = await CDPSession.connect(target.webSocketDebuggerUrl, signal)
  try {
    await session.call('Page.enable')
    await session.call('Page.addScriptToEvaluateOnNewDocument', { source: script })
    await session.call('Runtime.evaluate', { expression: script })
    ready()
    await session.waitForClose()
  } finally {
    session.close()
  }
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
    if (!message.id || !this.pending.has(message.id)) return
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
