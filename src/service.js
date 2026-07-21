import { closeSync, openSync } from 'node:fs'
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

import { processIsRunning, readPid } from './daemon.js'

const launchLabel = 'dev.ersync.retrynaut'
const windowsTask = 'Retrynaut'

export async function installService(paths, runtime, platform = process.platform) {
  await removeService(paths, platform)
  if (platform === 'darwin') return installLaunchAgent(paths, runtime)
  if (platform === 'win32') return installScheduledTask(paths, runtime)
  return installLinuxAgent(paths, runtime)
}

export async function startService(paths, platform = process.platform) {
  const runtime = await readRuntime(paths)
  if (platform === 'darwin') {
    run('launchctl', ['bootstrap', launchDomain(), paths.registration])
    run('launchctl', ['kickstart', '-k', `${launchDomain()}/${launchLabel}`])
  } else if (platform === 'win32') {
    run('schtasks.exe', ['/Run', '/TN', windowsTask])
  } else if (await fileExists(paths.systemdUnit) && systemdAvailable()) {
    run('systemctl', ['--user', 'start', 'retrynaut.service'])
  } else if (await fileExists(paths.xdgEntry)) {
    startDetached(paths, runtime)
  } else {
    throw new Error('Retrynaut is not installed')
  }
  return serviceState(paths, platform)
}

export async function stopService(paths, platform = process.platform) {
  if (platform === 'darwin') {
    runQuiet('launchctl', ['bootout', `${launchDomain()}/${launchLabel}`])
  } else if (platform === 'win32') {
    runQuiet('schtasks.exe', ['/End', '/TN', windowsTask])
  } else if (await fileExists(paths.systemdUnit) && systemdAvailable()) {
    runQuiet('systemctl', ['--user', 'stop', 'retrynaut.service'])
  }
  await stopPid(paths.pidFile)
}

export async function removeService(paths, platform = process.platform) {
  await stopService(paths, platform)
  if (platform === 'darwin') {
    await rm(paths.registration, { force: true })
  } else if (platform === 'win32') {
    runQuiet('schtasks.exe', ['/Delete', '/F', '/TN', windowsTask])
  } else {
    runQuiet('systemctl', ['--user', 'disable', '--now', 'retrynaut.service'])
    await rm(paths.systemdUnit, { force: true })
    await rm(paths.xdgEntry, { force: true })
    if (systemdAvailable()) runQuiet('systemctl', ['--user', 'daemon-reload'])
  }
}

export async function serviceState(paths, platform = process.platform) {
  let installed = false
  if (platform === 'darwin') {
    installed = await fileExists(paths.registration)
  } else if (platform === 'win32') {
    installed = commandOk('schtasks.exe', ['/Query', '/TN', windowsTask])
  } else {
    installed = await fileExists(paths.systemdUnit) || await fileExists(paths.xdgEntry)
  }
  const pid = await readPid(paths.pidFile)
  const running = Boolean(pid && await processIsRunning(pid))
  return { installed, running, pid, registration: paths.registration }
}

export function renderLaunchAgent(paths, runtime) {
  const escape = (value) => String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${launchLabel}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escape(runtime.nodePath)}</string>
    <string>${escape(runtime.cliPath)}</string>
    <string>run</string>
    <string>--config</string>
    <string>${escape(paths.configFile)}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escape(paths.logFile)}</string>
  <key>StandardErrorPath</key>
  <string>${escape(paths.logFile)}</string>
</dict>
</plist>
`
}

export function renderSystemdUnit(paths, runtime) {
  return `[Unit]
Description=Retrynaut background agent
After=graphical-session.target

[Service]
Type=simple
ExecStart=${systemdQuote(runtime.nodePath)} ${systemdQuote(runtime.cliPath)} run --config ${systemdQuote(paths.configFile)}
Restart=always
RestartSec=2
StandardOutput=append:${paths.logFile}
StandardError=append:${paths.logFile}

[Install]
WantedBy=default.target
`
}

export function renderXdgEntry(paths, runtime) {
  return `[Desktop Entry]
Type=Application
Name=Retrynaut
Exec=${desktopQuote(runtime.nodePath)} ${desktopQuote(runtime.cliPath)} run --config ${desktopQuote(paths.configFile)}
Terminal=false
X-GNOME-Autostart-enabled=true
`
}

export function renderScheduledCommand(paths, runtime) {
  return [runtime.nodePath, runtime.cliPath, 'run', '--config', paths.configFile]
    .map(windowsQuote)
    .join(' ')
}

async function installLaunchAgent(paths, runtime) {
  await mkdir(path.dirname(paths.registration), { recursive: true })
  await writeFile(paths.registration, renderLaunchAgent(paths, runtime), { mode: 0o644 })
  run('launchctl', ['bootstrap', launchDomain(), paths.registration])
  run('launchctl', ['kickstart', '-k', `${launchDomain()}/${launchLabel}`])
  return serviceState(paths, 'darwin')
}

async function installScheduledTask(paths, runtime) {
  const taskCommand = renderScheduledCommand(paths, runtime)
  run('schtasks.exe', [
    '/Create', '/F', '/SC', 'ONLOGON', '/RL', 'LIMITED',
    '/TN', windowsTask, '/TR', taskCommand,
  ])
  run('schtasks.exe', ['/Run', '/TN', windowsTask])
  return serviceState(paths, 'win32')
}

async function installLinuxAgent(paths, runtime) {
  if (systemdAvailable()) {
    await mkdir(path.dirname(paths.systemdUnit), { recursive: true })
    await writeFile(paths.systemdUnit, renderSystemdUnit(paths, runtime), { mode: 0o644 })
    await rm(paths.xdgEntry, { force: true })
    run('systemctl', ['--user', 'daemon-reload'])
    run('systemctl', ['--user', 'enable', '--now', 'retrynaut.service'])
  } else {
    await mkdir(path.dirname(paths.xdgEntry), { recursive: true })
    await writeFile(paths.xdgEntry, renderXdgEntry(paths, runtime), { mode: 0o644 })
    startDetached(paths, runtime)
  }
  return serviceState(paths, 'linux')
}

function startDetached(paths, runtime) {
  const log = openSync(paths.logFile, 'a', 0o600)
  try {
    const child = spawn(runtime.nodePath, [runtime.cliPath, 'run', '--config', paths.configFile], {
      detached: true,
      stdio: ['ignore', log, log],
    })
    child.unref()
  } finally {
    closeSync(log)
  }
}

async function stopPid(file) {
  const pid = await readPid(file)
  if (!pid || !await processIsRunning(pid)) {
    await rm(file, { force: true })
    return
  }
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    await rm(file, { force: true })
    return
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!await processIsRunning(pid)) break
    await delay(100)
  }
  if (!await processIsRunning(pid)) await rm(file, { force: true })
}

async function readRuntime(paths) {
  try {
    return JSON.parse(await readFile(paths.runtimeFile, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('Retrynaut is not installed')
    throw error
  }
}

function launchDomain() {
  return `gui/${process.getuid()}`
}

function systemdAvailable() {
  return commandOk('systemctl', ['--user', 'show-environment'])
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const message = (result.stderr || result.stdout || `${command} failed`).trim()
    throw new Error(message)
  }
  return result.stdout.trim()
}

function runQuiet(command, args) {
  try {
    run(command, args)
  } catch {
    return false
  }
  return true
}

function commandOk(command, args) {
  const result = spawnSync(command, args, { stdio: 'ignore', windowsHide: true })
  return !result.error && result.status === 0
}

async function fileExists(file) {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}

function systemdQuote(value) {
  return `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

function desktopQuote(value) {
  return `"${String(value)
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('$', '\\$')
    .replaceAll('`', '\\`')
    .replaceAll('%', '%%')}"`
}

function windowsQuote(value) {
  return `"${String(value).replaceAll('"', '\\"')}"`
}
