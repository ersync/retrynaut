import { closeSync, openSync } from 'node:fs'
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

import { agentStatus, stopAgent } from './control.js'

const launchLabel = 'dev.ersync.retrynaut'
const windowsTask = 'Retrynaut'

export async function installService(paths, runtime, platform = process.platform) {
  await removeService(paths, platform)
  if (platform === 'darwin') return installLaunchAgent(paths, runtime)
  if (platform === 'win32') return installScheduledTask(paths, runtime)
  return installLinuxAgent(paths, runtime)
}

export async function startService(paths, platform = process.platform) {
  const current = await serviceState(paths, platform)
  if (current.running) return current

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
  return waitForAgent(paths, platform)
}

export async function stopService(paths, platform = process.platform) {
  if (platform === 'darwin') {
    runQuiet('launchctl', ['bootout', `${launchDomain()}/${launchLabel}`])
  } else if (platform === 'win32') {
    await stopAgent(paths)
    runQuiet('schtasks.exe', ['/End', '/TN', windowsTask])
  } else if (await fileExists(paths.systemdUnit) && systemdAvailable()) {
    runQuiet('systemctl', ['--user', 'stop', 'retrynaut.service'])
  } else {
    await stopAgent(paths)
  }
  await waitForStopped(paths)
}

export async function removeService(paths, platform = process.platform) {
  await stopService(paths, platform)
  if (platform === 'darwin') {
    await rm(paths.registration, { force: true })
  } else if (platform === 'win32') {
    runQuiet('schtasks.exe', ['/Delete', '/F', '/TN', windowsTask])
    await rm(paths.windowsTaskXml, { force: true })
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
  const agent = await agentStatus(paths)
  return {
    installed,
    running: Boolean(agent),
    pid: agent?.pid,
    startedAt: agent?.startedAt,
    retry: agent?.retry,
    registration: paths.registration,
  }
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
StandardOutput=append:${systemdSpecifierEscape(paths.logFile)}
StandardError=append:${systemdSpecifierEscape(paths.logFile)}

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

export function renderWindowsTask(paths, runtime, user) {
  const escape = xmlEscape
  const argumentsText = [runtime.cliPath, 'run', '--config', paths.configFile]
    .map(windowsQuote)
    .join(' ')
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Retrynaut background agent</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>${escape(user)}</UserId>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>${escape(user)}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>true</Hidden>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>999</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${escape(runtime.nodePath)}</Command>
      <Arguments>${escape(argumentsText)}</Arguments>
      <WorkingDirectory>${escape(path.win32.dirname(runtime.cliPath))}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`
}

async function installLaunchAgent(paths, runtime) {
  await mkdir(path.dirname(paths.registration), { recursive: true })
  await writeFile(paths.registration, renderLaunchAgent(paths, runtime), { mode: 0o644 })
  run('launchctl', ['bootstrap', launchDomain(), paths.registration])
  run('launchctl', ['kickstart', '-k', `${launchDomain()}/${launchLabel}`])
  return waitForAgent(paths, 'darwin')
}

async function installScheduledTask(paths, runtime) {
  const user = run('whoami.exe', [])
  await writeUtf16(paths.windowsTaskXml, renderWindowsTask(paths, runtime, user))
  run('schtasks.exe', ['/Create', '/F', '/TN', windowsTask, '/XML', paths.windowsTaskXml])
  run('schtasks.exe', ['/Run', '/TN', windowsTask])
  return waitForAgent(paths, 'win32')
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
  return waitForAgent(paths, 'linux')
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

async function readRuntime(paths) {
  try {
    return JSON.parse(await readFile(paths.runtimeFile, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('Retrynaut is not installed')
    throw error
  }
}

async function waitForAgent(paths, platform) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await agentStatus(paths)) return serviceState(paths, platform)
    await delay(100)
  }
  throw new Error(`background agent did not become healthy; check ${paths.logFile}`)
}

async function waitForStopped(paths) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (!await agentStatus(paths)) return
    await delay(100)
  }
  throw new Error('background agent did not stop cleanly')
}

async function writeUtf16(file, contents) {
  await mkdir(path.dirname(file), { recursive: true })
  const body = Buffer.from(contents, 'utf16le')
  await writeFile(file, Buffer.concat([Buffer.from([0xff, 0xfe]), body]), { mode: 0o600 })
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
  return `"${String(value)
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('%', '%%')}"`
}

function systemdSpecifierEscape(value) {
  return String(value).replaceAll('%', '%%')
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

function xmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}
