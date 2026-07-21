import os from 'node:os'
import path from 'node:path'

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
    runtimeDir,
    runtimeCli: path.join(runtimeDir, 'bin', 'retrynaut.js'),
  }

  if (platform === 'darwin') {
    paths.registration = path.join(home, 'Library', 'LaunchAgents', 'dev.ersync.retrynaut.plist')
  } else if (platform === 'win32') {
    paths.registration = 'Task Scheduler: Retrynaut'
  } else {
    const configHome = env.XDG_CONFIG_HOME || path.join(home, '.config')
    paths.systemdUnit = path.join(configHome, 'systemd', 'user', 'retrynaut.service')
    paths.xdgEntry = path.join(configHome, 'autostart', 'retrynaut.desktop')
    paths.registration = paths.systemdUnit
  }
  return paths
}
