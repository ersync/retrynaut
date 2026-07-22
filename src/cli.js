import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'

import { isAntigravityPage, listTargets, pauseControllers, queryStatus } from './cdp.js'
import { loadConfig, purgeConfigDir, saveConfig } from './config.js'
import { runDaemon } from './daemon.js'
import { findPort } from './discovery.js'
import { output } from './output.js'
import { appPaths } from './paths.js'
import { buildStatus, modeLabel, printStatus } from './presentation.js'
import { installRuntime, loadRuntime, removeRuntime } from './runtime.js'
import { installService, removeService, serviceState, startService, stopService } from './service.js'

const packageInfo = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

export async function main(args) {
  const [command = 'help', ...rest] = args
  switch (command) {
    case 'run':
      return runCommand(rest)
    case 'doctor':
      return doctorCommand(rest)
    case 'status':
      return statusCommand(rest)
    case 'install':
      return installCommand(rest)
    case 'configure':
      return configureCommand(rest)
    case 'start':
      return startCommand(rest)
    case 'stop':
      return stopCommand(rest)
    case 'uninstall':
      return uninstallCommand(rest)
    case 'version':
    case '--version':
    case '-v':
      output.line(`retrynaut ${packageInfo.version}`)
      return
    case 'help':
    case '--help':
    case '-h':
      printHelp()
      return
    default:
      throw new Error(`unknown command: ${command}`)
  }
}

async function runCommand(args) {
  const paths = appPaths()
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      config: { type: 'string', default: paths.configFile },
      'port-file': { type: 'string' },
      verbose: { type: 'boolean', default: false },
    },
  })
  await runDaemon({
    paths,
    configFile: values.config,
    portFile: values['port-file'],
    verbose: values.verbose,
  })
}

async function doctorCommand(args) {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      'port-file': { type: 'string' },
      verbose: { type: 'boolean', default: false },
    },
  })
  let port
  let file
  let targets
  try {
    ({ port, file } = await findPort(values['port-file']))
    targets = (await listTargets(port)).filter(isAntigravityPage)
    if (targets.length === 0) {
      const error = new Error('no compatible Antigravity page was found')
      error.code = 'NO_ANTIGRAVITY_PAGE'
      throw error
    }
  } catch (error) {
    throw new Error(formatDoctorFailure(error, {
      file,
      port,
      verbose: values.verbose,
    }))
  }

  output.line(`Debug connection: ${output.green('Available')} ${output.dim(`(port ${port})`)}`)
  output.line(`Antigravity: ${output.green('Connected')}`)
  if (targets.length > 1) {
    output.blank()
    output.warning('Multiple pages found; Retrynaut watches one at a time.')
  }
  output.blank()
  output.line(output.dim('No clicks performed.'))
  if (values.verbose) {
    output.blank()
    output.section('Details')
    output.rows([
      ['Antigravity pages', targets.length],
      ['Port file', file],
    ])
  }
}

function formatDoctorFailure(error, { file, port, verbose }) {
  const cause = deepestCause(error)
  let message

  if (error.code === 'NO_ANTIGRAVITY_PAGE') {
    message = 'Antigravity is still opening.\n\nWait a moment, then try again.'
  } else if (isUnavailable(error, cause)) {
    message = 'Cannot find Antigravity.\n\nMake sure it is open, then try again.'
  } else {
    message = 'Could not check Antigravity.\n\nRestart it, then try again.'
  }

  if (!verbose) return message

  const details = [cause.message]
  if (port) details.push(`Port: ${port}`)
  if (file) details.push(`Port file: ${file}`)
  return `${message}\n\nDetails\n${details.map((detail) => `  ${detail}`).join('\n')}`
}

function deepestCause(error) {
  let cause = error
  while (cause?.cause instanceof Error) cause = cause.cause
  return cause
}

function isUnavailable(error, cause) {
  return error.message === 'DevToolsActivePort was not found'
    || error.message.startsWith('invalid debugging port:')
    || error.message === 'fetch failed'
    || ['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ETIMEDOUT'].includes(cause.code)
    || ['AbortError', 'TimeoutError'].includes(cause.name)
}

async function statusCommand(args) {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      json: { type: 'boolean', default: false },
      verbose: { type: 'boolean', default: false },
    },
  })
  const paths = appPaths()
  const state = await serviceState(paths)
  const config = await loadConfig(paths.configFile)
  let runtime
  let runtimeError
  if (state.installed) {
    try {
      runtime = await loadRuntime(paths)
    } catch (error) {
      runtimeError = error.message
    }
  }

  let controller
  let pageCount = 0
  try {
    const { port } = await findPort()
    const targets = (await listTargets(port)).filter(isAntigravityPage)
    pageCount = targets.length
    for (const target of targets) {
      try {
        controller = await queryStatus(target)
        break
      } catch {
        continue
      }
    }
  } catch {
    // Antigravity is not ready yet.
  }

  const status = buildStatus({
    config,
    controller,
    pageCount,
    paths,
    runtime,
    runtimeError,
    state,
  }, packageInfo.version)
  if (values.json) {
    output.line(JSON.stringify(status, null, 2))
    return
  }
  printStatus(status, values.verbose)
}

async function installCommand(args) {
  const paths = appPaths()
  const current = await loadConfig(paths.configFile)
  const next = applyConfigArgs(current, args, false)
  await saveConfig(paths.configFile, next)
  await pauseCurrentController()
  await stopService(paths)
  const runtime = await installRuntime(paths)
  await installService(paths, runtime)
  output.line(`Automatic retry: ${output.green('On')}`)
  output.blank()
  output.line(output.dim('Starts automatically at sign-in.'))
}

async function configureCommand(args) {
  const paths = appPaths()
  const current = await loadConfig(paths.configFile)
  const next = applyConfigArgs(current, args, true)
  await saveConfig(paths.configFile, next)
  const state = await serviceState(paths)
  if (state.startupEnabled) {
    await pauseCurrentController()
    await stopService(paths)
    await startService(paths)
  }
  output.line('Configuration saved.')
  output.blank()
  output.line(`Mode: ${modeLabel(next.mode)} · Retry limit: ${next.maxRetriesPerMinute}/min`)
  if (!state.installed) output.line(output.dim('Run `retrynaut install` to turn it on.'))
}

async function startCommand(args) {
  parseArgs({ args, strict: true })
  const paths = appPaths()
  const before = await serviceState(paths)
  await startService(paths)
  output.line(`Automatic retry: ${output.green('On')}`)
  if (before.running && before.startupEnabled) {
    output.line(output.dim('Already running.'))
  } else {
    output.blank()
    output.line(output.dim('It will also start automatically at sign-in.'))
  }
}

async function stopCommand(args) {
  parseArgs({ args, strict: true })
  const paths = appPaths()
  const before = await serviceState(paths)
  await pauseCurrentController()
  await stopService(paths)
  output.line(`Automatic retry: ${output.yellow('Off')}`)
  if (!before.running && !before.startupEnabled) output.line(output.dim('Already stopped.'))
  output.blank()
  output.line(output.dim('Run `retrynaut start` to turn it back on.'))
}

async function uninstallCommand(args) {
  const { values } = parseArgs({
    args,
    strict: true,
    options: { purge: { type: 'boolean', default: false } },
  })
  const paths = appPaths()
  await pauseCurrentController()
  await removeService(paths)
  await removeRuntime(paths)
  if (values.purge) {
    await purgeConfigDir(paths.configDir)
    output.line('Retrynaut uninstalled.')
    output.line(output.dim('Configuration and logs removed.'))
  } else {
    output.line('Retrynaut uninstalled.')
    output.line(output.dim('Configuration and logs kept. Use --purge to remove them too.'))
  }
}

function applyConfigArgs(current, args, includeTiming) {
  const options = {
    mode: { type: 'string' },
    'max-per-minute': { type: 'string' },
    'require-focus': { type: 'boolean' },
  }
  if (includeTiming) {
    options['scan-interval-ms'] = { type: 'string' }
  }
  const { values } = parseArgs({ args, strict: true, allowNegative: true, options })
  return {
    ...current,
    ...(values.mode !== undefined ? { mode: values.mode } : {}),
    ...(values['max-per-minute'] !== undefined
      ? { maxRetriesPerMinute: integer(values['max-per-minute'], '--max-per-minute') }
      : {}),
    ...(values['require-focus'] !== undefined ? { requireFocus: values['require-focus'] } : {}),
    ...(values['scan-interval-ms'] !== undefined
      ? { scanIntervalMs: integer(values['scan-interval-ms'], '--scan-interval-ms') }
      : {}),
  }
}

async function pauseCurrentController() {
  try {
    const { port } = await findPort()
    await pauseControllers(port)
  } catch {
    // Nothing is attached yet.
  }
}

function integer(value, option) {
  if (!/^-?\d+$/.test(value)) throw new Error(`${option} must be an integer`)
  return Number(value)
}

function printHelp() {
  output.line(`${output.bold(`Retrynaut ${packageInfo.version}`)}
Automatic retry companion for Antigravity

Usage:
  retrynaut <command> [options]

Commands:
  install [--max-per-minute 20]
  configure [options]
  doctor [--verbose]
  status [--json] [--verbose]
  start
  stop
  uninstall [--purge]
  version`)
}
