import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'

import { isAntigravityPage, listTargets, pauseControllers, queryStatus } from './cdp.js'
import { loadConfig, purgeConfigDir, saveConfig } from './config.js'
import { runDaemon } from './daemon.js'
import { findPort } from './discovery.js'
import { output } from './output.js'
import { appPaths } from './paths.js'
import { buildStatus, modeLabel, printStatus } from './presentation.js'
import { installRuntime, loadRuntime } from './runtime.js'
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
  const { port, file } = await findPort(values['port-file'])
  const targets = (await listTargets(port)).filter(isAntigravityPage)
  if (targets.length === 0) throw new Error('CDP is available, but no Antigravity page is ready')

  output.title('Retrynaut', 'doctor')
  output.blank()
  output.checks([
    ['Debug connection', `Available ${output.dim(`· port ${port}`)}`],
    ['Antigravity page', `${targets.length} found`],
  ])
  if (targets.length > 1) {
    output.blank()
    output.warning('Multiple pages found; Retrynaut watches one at a time.')
  }
  if (values.verbose) {
    output.blank()
    output.section('Details')
    output.rows([['Port file', file]])
  }
  output.blank()
  output.success('Ready — no clicks performed')
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
  const state = await installService(paths, runtime)
  output.success('Retrynaut installed')
  output.blank()
  output.rows([
    ['Agent', `${output.green('Running')} ${output.dim(`· pid ${state.pid}`)}`],
    ['Mode', modeLabel(next.mode)],
    ['Circuit breaker', `${next.maxRetriesPerMinute} clicks / 60 sec`],
  ])
  output.blank()
  output.line(output.dim('Run `retrynaut status` at any time.'))
}

async function configureCommand(args) {
  const paths = appPaths()
  const current = await loadConfig(paths.configFile)
  const next = applyConfigArgs(current, args, true)
  await saveConfig(paths.configFile, next)
  const state = await serviceState(paths)
  if (state.installed) {
    await pauseCurrentController()
    await stopService(paths)
    await startService(paths)
  }
  output.success('Configuration saved')
  output.blank()
  output.rows([
    ['Mode', modeLabel(next.mode)],
    ['Circuit breaker', `${next.maxRetriesPerMinute} clicks / 60 sec`],
    ['Auto-continue', next.autoContinue ? output.green('Enabled') : 'Disabled'],
    ['Agent', state.installed ? output.green('Restarted') : output.yellow('Not installed')],
  ])
}

async function startCommand(args) {
  parseArgs({ args, strict: true })
  const paths = appPaths()
  const before = await serviceState(paths)
  const state = await startService(paths)
  output.success(before.running ? 'Retrynaut is already running' : 'Retrynaut started')
  output.line(output.dim(`  pid ${state.pid}`))
}

async function stopCommand(args) {
  parseArgs({ args, strict: true })
  const paths = appPaths()
  const before = await serviceState(paths)
  await pauseCurrentController()
  await stopService(paths)
  output.success(before.running ? 'Retrynaut stopped' : 'Retrynaut is already stopped')
  output.line(output.dim('  Automatic startup remains enabled.'))
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
  if (values.purge) {
    await purgeConfigDir(paths.configDir)
    output.success('Retrynaut removed')
    output.line(output.dim('  Background agent, runtime, logs, and configuration deleted.'))
  } else {
    output.success('Background agent removed')
    output.line(output.dim('  Runtime and configuration kept. Use --purge to remove them too.'))
  }
}

function applyConfigArgs(current, args, includeTiming) {
  const options = {
    mode: { type: 'string' },
    'max-per-minute': { type: 'string' },
    'auto-continue': { type: 'boolean' },
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
    ...(values['auto-continue'] !== undefined ? { autoContinue: values['auto-continue'] } : {}),
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
