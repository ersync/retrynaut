import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)))

export async function installRuntime(paths, nodePath = process.execPath, sourceRoot = packageRoot) {
  await mkdir(paths.configDir, { recursive: true })
  const temporary = path.join(paths.configDir, `runtime-${process.pid}.tmp`)
  await rm(temporary, { recursive: true, force: true })
  await mkdir(temporary, { recursive: true })
  await cp(path.join(sourceRoot, 'src'), path.join(temporary, 'src'), { recursive: true })
  await cp(path.join(sourceRoot, 'bin'), path.join(temporary, 'bin'), { recursive: true })
  await cp(path.join(sourceRoot, 'package.json'), path.join(temporary, 'package.json'))
  const packageInfo = JSON.parse(await readFile(path.join(sourceRoot, 'package.json'), 'utf8'))
  await rm(paths.runtimeDir, { recursive: true, force: true })
  await rename(temporary, paths.runtimeDir)
  if (paths.pidFile) await rm(paths.pidFile, { force: true })
  await writeFile(paths.runtimeFile, `${JSON.stringify({
    version: packageInfo.version,
    nodePath,
    cliPath: paths.runtimeCli,
    installedAt: new Date().toISOString(),
  }, null, 2)}\n`, { mode: 0o600 })
  return { version: packageInfo.version, nodePath, cliPath: paths.runtimeCli }
}

export async function loadRuntime(paths) {
  try {
    const runtime = JSON.parse(await readFile(paths.runtimeFile, 'utf8'))
    if (!runtime.nodePath || !runtime.cliPath) throw new Error('runtime metadata is incomplete')
    return runtime
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('Retrynaut is not installed')
    throw error
  }
}
