import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'

import { isAntigravityPage, listTargets, pauseControllers, queryStatus } from './cdp.js'
import { loadConfig, purgeConfigDir, saveConfig } from './config.js'
import { runDaemon } from './daemon.js'
import { findPort, portFiles, readPort } from './discovery.js'
import { appPaths } from './paths.js'
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
      console.log(`retrynaut ${packageInfo.version}`)
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
    options: { 'port-file': { type: 'string' } },
  })
  console.log('Retrynaut doctor')
  for (const file of portFiles(values['port-file'])) {
    try {
      await readPort(file)
      console.log(`  ${file}: ok`)
    } catch (error) {
      console.log(`  ${file}: ${error.code === 'ENOENT' ? 'not found' : error.message}`)
    }
  }

  const { port, file } = await findPort(values['port-file'])
  console.log(`debugging port: ${port} (${file})`)
  const targets = (await listTargets(port)).filter(isAntigravityPage)
  if (targets.length === 0) throw new Error('CDP is available, but no Antigravity page is ready')
  console.log(`Antigravity pages: ${targets.length}`)
  if (targets.length > 1) console.log('warning: Retrynaut watches one Antigravity page at a time')
  console.log('result: ready')
}

async function statusCommand(args) {
  parseArgs({ args, strict: true })
  const paths = appPaths()
  const state = await serviceState(paths)
  console.log(`CLI version: ${packageInfo.version}`)
  console.log(`installed: ${yesNo(state.installed)}`)
  console.log(`background agent: ${state.running ? `running (pid ${state.pid})` : 'stopped'}`)
  if (state.installed) {
    try {
      const runtime = await loadRuntime(paths)
      console.log(`installed version: ${runtime.version || 'unknown'}`)
      console.log(`installed node: ${runtime.nodePath}`)
      console.log(`installed at: ${runtime.installedAt || 'unknown'}`)
    } catch (error) {
      console.log(`installed runtime: ${error.message}`)
    }
  }

  try {
    const { port } = await findPort()
    const targets = (await listTargets(port)).filter(isAntigravityPage)
    for (const target of targets) {
      try {
        console.log(JSON.stringify(await queryStatus(target), null, 2))
        return
      } catch {
        continue
      }
    }
    console.log('controller: waiting for Antigravity')
  } catch {
    console.log('controller: waiting for Antigravity')
  }
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
  console.log(`installed: ${paths.runtimeDir}`)
  console.log(`startup: ${state.registration}`)
  console.log(`background agent: running (pid ${state.pid})`)
  console.log(`mode=${next.mode} max=${next.maxRetriesPerMinute}/min`)
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
  console.log(`saved ${paths.configFile}`)
  console.log(`mode=${next.mode} max=${next.maxRetriesPerMinute}/min auto-continue=${next.autoContinue}`)
}

async function startCommand(args) {
  parseArgs({ args, strict: true })
  const state = await startService(appPaths())
  console.log(`Retrynaut started (pid ${state.pid}).`)
}

async function stopCommand(args) {
  parseArgs({ args, strict: true })
  await pauseCurrentController()
  await stopService(appPaths())
  console.log('Retrynaut stopped. Automatic startup remains enabled.')
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
    console.log('Background agent, runtime, logs, and configuration removed.')
  } else {
    console.log('Background agent removed. Run with --purge to remove its files and configuration too.')
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
    options['retry-delay-ms'] = { type: 'string' }
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
    ...(values['retry-delay-ms'] !== undefined
      ? { retryDelayMs: integer(values['retry-delay-ms'], '--retry-delay-ms') }
      : {}),
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

function yesNo(value) {
  return value ? 'yes' : 'no'
}

function printHelp() {
  console.log(`Retrynaut - automatic retry companion for Antigravity

Usage:
  retrynaut install [--max-per-minute 20]
  retrynaut configure [options]
  retrynaut doctor
  retrynaut status
  retrynaut start
  retrynaut stop
  retrynaut uninstall [--purge]
  retrynaut run [--verbose]
  retrynaut version`)
}
