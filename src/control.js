import { randomBytes, timingSafeEqual } from 'node:crypto'
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'

export async function createControlServer(paths, handlers) {
  const token = await controlToken(paths)
  const sockets = new Set()
  const server = net.createServer((socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    handleConnection(socket, token, handlers)
  })

  try {
    await listen(server, paths.controlEndpoint)
  } catch (error) {
    if (error.code !== 'EADDRINUSE') throw error
    try {
      await requestControl(paths, 'status', 300)
      throw new Error('Retrynaut is already running')
    } catch (probeError) {
      if (probeError.message === 'Retrynaut is already running') throw probeError
      if (process.platform === 'win32') throw error
      await rm(paths.controlEndpoint, { force: true })
      await listen(server, paths.controlEndpoint)
    }
  }

  if (process.platform !== 'win32') {
    try {
      await chmod(paths.controlEndpoint, 0o600)
    } catch (error) {
      await closeServer(server, sockets, paths.controlEndpoint)
      throw error
    }
  }
  return {
    close: () => closeServer(server, sockets, paths.controlEndpoint),
  }
}

export async function requestControl(paths, command, timeoutMs = 1_000) {
  const token = await controlToken(paths, false)
  if (!token) throw new Error('Retrynaut control endpoint is unavailable')

  return new Promise((resolve, reject) => {
    const socket = net.createConnection(paths.controlEndpoint)
    let response = ''
    let settled = false
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      callback(value)
    }
    const timer = setTimeout(() => {
      socket.destroy()
      finish(reject, new Error('Retrynaut control request timed out'))
    }, timeoutMs)

    socket.setEncoding('utf8')
    socket.on('connect', () => {
      socket.write(`${JSON.stringify({ token, command })}\n`)
    })
    socket.on('data', (chunk) => {
      response += chunk
      if (response.length > 16_384) socket.destroy(new Error('control response is too large'))
      const newline = response.indexOf('\n')
      if (newline === -1) return
      socket.end()
      try {
        const message = JSON.parse(response.slice(0, newline))
        if (!message.ok) finish(reject, new Error(message.error || 'control request failed'))
        else finish(resolve, message.result)
      } catch (error) {
        finish(reject, error)
      }
    })
    socket.on('error', (error) => {
      finish(reject, error)
    })
    socket.on('close', () => {
      if (!settled) finish(reject, new Error('Retrynaut control endpoint closed without a response'))
    })
  })
}

export async function agentStatus(paths) {
  try {
    return await requestControl(paths, 'status', 2_000)
  } catch {
    return undefined
  }
}

export async function stopAgent(paths) {
  try {
    await requestControl(paths, 'stop', 1_000)
  } catch {
    return false
  }
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (!await agentStatus(paths)) return true
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return false
}

async function controlToken(paths, create = true) {
  let token
  try {
    token = (await readFile(paths.controlKeyFile, 'utf8')).trim()
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    if (!create) return undefined
  }
  if (token !== undefined) {
    if (!/^[0-9a-f]{64}$/.test(token)) throw new Error('Retrynaut control key is invalid')
    if (process.platform !== 'win32') await chmod(paths.controlKeyFile, 0o600)
    return token
  }
  await mkdir(path.dirname(paths.controlKeyFile), { recursive: true })
  const newToken = randomBytes(32).toString('hex')
  try {
    await writeFile(paths.controlKeyFile, `${newToken}\n`, { mode: 0o600, flag: 'wx' })
    return newToken
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    return controlToken(paths, false)
  }
}

function handleConnection(socket, expectedToken, handlers) {
  let input = ''
  socket.setEncoding('utf8')
  socket.on('data', async (chunk) => {
    input += chunk
    if (input.length > 4_096) {
      socket.destroy()
      return
    }
    const newline = input.indexOf('\n')
    if (newline === -1) return
    socket.pause()
    try {
      const request = JSON.parse(input.slice(0, newline))
      if (!tokensMatch(request.token, expectedToken)) throw new Error('unauthorized control request')
      const handler = handlers[request.command]
      if (!handler) throw new Error('unknown control command')
      const result = await handler()
      socket.end(`${JSON.stringify({ ok: true, result })}\n`)
    } catch (error) {
      socket.end(`${JSON.stringify({ ok: false, error: error.message })}\n`)
    }
  })
}

function tokensMatch(actual, expected) {
  if (typeof actual !== 'string' || actual.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
}

function listen(server, endpoint) {
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error)
    server.once('error', onError)
    server.listen(endpoint, () => {
      server.removeListener('error', onError)
      resolve()
    })
  })
}

async function closeServer(server, sockets, endpoint) {
  for (const socket of sockets) socket.destroy()
  if (server.listening) await new Promise((resolve) => server.close(resolve))
  if (process.platform !== 'win32') await rm(endpoint, { force: true })
}
