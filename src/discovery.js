import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export function portFiles(override, env = process.env, platform = process.platform) {
  if (override) return [override]
  if (env.ANTIGRAVITY_USER_DATA_DIR) {
    return [path.join(env.ANTIGRAVITY_USER_DATA_DIR, 'DevToolsActivePort')]
  }

  const home = os.homedir()
  if (platform === 'darwin') {
    return unique([
      path.join(home, 'Library', 'Application Support', 'Antigravity', 'DevToolsActivePort'),
      path.join(home, 'Library', 'Application Support', 'antigravity', 'DevToolsActivePort'),
    ], platform)
  }
  if (platform === 'win32') {
    return unique([env.APPDATA, env.LOCALAPPDATA]
      .filter(Boolean)
      .map((base) => path.join(base, 'Antigravity', 'DevToolsActivePort')), platform)
  }

  const base = env.XDG_CONFIG_HOME || path.join(home, '.config')
  return unique([
    path.join(base, 'Antigravity', 'DevToolsActivePort'),
    path.join(base, 'antigravity', 'DevToolsActivePort'),
  ], platform)
}

export async function readPort(file) {
  const [line = ''] = (await readFile(file, 'utf8')).split(/\r?\n/, 1)
  const port = Number(line.trim())
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`invalid debugging port: ${JSON.stringify(line)}`)
  }
  return port
}

export async function findPort(override) {
  let usefulError
  for (const file of portFiles(override)) {
    try {
      return { port: await readPort(file), file }
    } catch (error) {
      if (error.code !== 'ENOENT') usefulError = error
    }
  }
  if (usefulError) throw usefulError
  throw new Error('DevToolsActivePort was not found')
}

function unique(values, platform) {
  const seen = new Set()
  return values.filter((value) => {
    const key = platform === 'darwin' || platform === 'win32' ? value.toLowerCase() : value
    if (!value || seen.has(key)) return false
    seen.add(key)
    return true
  })
}
