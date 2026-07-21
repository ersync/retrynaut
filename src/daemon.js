import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

import { runController } from './cdp.js'
import { loadConfig } from './config.js'
import { createControlServer } from './control.js'
import { findPort } from './discovery.js'
import { buildScript } from './inject.js'

export async function runDaemon({ paths, configFile, portFile, verbose = false }) {
  await mkdir(path.dirname(paths.logFile), { recursive: true })
  const log = createWriteStream(paths.logFile, { flags: 'a', mode: 0o600 })
  const startedAt = new Date().toISOString()
  const logger = {
    log(message) {
      log.write(`${new Date().toISOString()} ${message}\n`)
      if (verbose) console.log(message)
    },
  }
  const controller = new AbortController()
  let stop
  let control
  try {
    const config = await loadConfig(configFile)
    const script = buildScript(config)
    stop = () => controller.abort()
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    control = await createControlServer(paths, {
      status: () => ({ pid: process.pid, startedAt }),
      stop: () => {
        setImmediate(stop)
        return { stopping: true }
      },
    })

    logger.log(`starting (mode=${config.mode}, max=${config.maxRetriesPerMinute}/min)`)
    await runController({
      findPort: () => findPort(portFile),
      script,
      signal: controller.signal,
      logger,
      verbose,
    })
  } catch (error) {
    logger.log(`stopped with error: ${error.message}`)
    throw error
  } finally {
    if (stop) {
      process.removeListener('SIGINT', stop)
      process.removeListener('SIGTERM', stop)
    }
    await control?.close()
    await new Promise((resolve) => log.end(resolve))
  }
}
