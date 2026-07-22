import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'

export function appPaths({
  env = process.env,
  platform = process.platform,
  home = os.homedir(),
} = {}) {
  const nativePath = platform === 'win32' ? path.win32 : path.posix
  let configDir
  if (platform === 'darwin') {
    configDir = nativePath.join(home, 'Library', 'Application Support', 'retrynaut')
  } else if (platform === 'win32') {
    configDir = nativePath.join(
      env.APPDATA || nativePath.join(home, 'AppData', 'Roaming'),
      'retrynaut',
    )
  } else {
    configDir = nativePath.join(
      env.XDG_CONFIG_HOME || nativePath.join(home, '.config'),
      'retrynaut',
    )
  }

  const runtimeDir = nativePath.join(configDir, 'runtime')
  const paths = {
    configDir,
    configFile: nativePath.join(configDir, 'config.json'),
    logFile: nativePath.join(configDir, 'retrynaut.log'),
    pidFile: nativePath.join(configDir, 'retrynaut.pid'),
    runtimeFile: nativePath.join(configDir, 'runtime.json'),
    controlKeyFile: nativePath.join(configDir, 'control.key'),
    runtimeDir,
    runtimeCli: nativePath.join(runtimeDir, 'bin', 'retrynaut.js'),
  }

  paths.controlEndpoint = platform === 'win32'
    ? `\\\\.\\pipe\\retrynaut-${createHash('sha256').update(configDir).digest('hex').slice(0, 12)}`
    : nativePath.join(configDir, 'control.sock')

  if (platform === 'darwin') {
    paths.registration = nativePath.join(
      home,
      'Library',
      'LaunchAgents',
      'dev.ersync.retrynaut.plist',
    )
  } else if (platform === 'win32') {
    paths.registration = 'Task Scheduler: Retrynaut'
    paths.windowsTaskXml = nativePath.join(configDir, 'retrynaut-task.xml')
  } else {
    const configHome = env.XDG_CONFIG_HOME || nativePath.join(home, '.config')
    paths.systemdUnit = nativePath.join(configHome, 'systemd', 'user', 'retrynaut.service')
    paths.xdgEntry = nativePath.join(configHome, 'autostart', 'retrynaut.desktop')
    paths.registration = paths.systemdUnit
  }
  return paths
}
