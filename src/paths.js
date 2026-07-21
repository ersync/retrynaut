import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'

export function appPaths({
  env = process.env,
  platform = process.platform,
  home = os.homedir(),
} = {}) {
  let configDir
  if (platform === 'darwin') {
    configDir = path.join(home, 'Library', 'Application Support', 'retrynaut')
  } else if (platform === 'win32') {
    configDir = path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'retrynaut')
  } else {
    configDir = path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'retrynaut')
  }

  const runtimeDir = path.join(configDir, 'runtime')
  const paths = {
    configDir,
    configFile: path.join(configDir, 'config.json'),
    logFile: path.join(configDir, 'retrynaut.log'),
    pidFile: path.join(configDir, 'retrynaut.pid'),
    runtimeFile: path.join(configDir, 'runtime.json'),
    controlKeyFile: path.join(configDir, 'control.key'),
    runtimeDir,
    runtimeCli: path.join(runtimeDir, 'bin', 'retrynaut.js'),
  }

  paths.controlEndpoint = platform === 'win32'
    ? `\\\\.\\pipe\\retrynaut-${createHash('sha256').update(configDir).digest('hex').slice(0, 12)}`
    : path.join(configDir, 'control.sock')

  if (platform === 'darwin') {
    paths.registration = path.join(home, 'Library', 'LaunchAgents', 'dev.ersync.retrynaut.plist')
  } else if (platform === 'win32') {
    paths.registration = 'Task Scheduler: Retrynaut'
    paths.windowsTaskXml = path.join(configDir, 'retrynaut-task.xml')
  } else {
    const configHome = env.XDG_CONFIG_HOME || path.join(home, '.config')
    paths.systemdUnit = path.join(configHome, 'systemd', 'user', 'retrynaut.service')
    paths.xdgEntry = path.join(configHome, 'autostart', 'retrynaut.desktop')
    paths.registration = paths.systemdUnit
  }
  return paths
}
