import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const temporary = await mkdtemp(path.join(os.tmpdir(), 'retrynaut-pack-'))
let tarball

try {
  const packed = run(npm, [
    'pack', '--json', '--ignore-scripts', '--pack-destination', temporary,
  ], root)
  const result = JSON.parse(packed)
  assert.equal(result.length, 1)
  tarball = path.join(temporary, result[0].filename)
  const packagedFiles = new Set(result[0].files.map(({ path: file }) => file))
  assert.ok(packagedFiles.has('bin/retrynaut.js'))
  assert.ok(packagedFiles.has('src/retry.js'))
  assert.ok(packagedFiles.has('README.md'))
  assert.ok(![...packagedFiles].some((file) => file.startsWith('test/')))

  const installDir = path.join(temporary, 'installed')
  await mkdir(installDir)
  run(npm, ['install', '--ignore-scripts', '--prefix', installDir, tarball], root)
  const installedPackage = path.join(installDir, 'node_modules', 'retrynaut')
  const metadata = JSON.parse(await readFile(path.join(installedPackage, 'package.json'), 'utf8'))
  assert.equal(metadata.name, 'retrynaut')
  const help = run(process.execPath, [path.join(installedPackage, 'bin', 'retrynaut.js'), '--help'], root)
  assert.match(help, /automatic retry companion/i)
  console.log(`package smoke test passed (${result[0].entryCount} files)`)
} finally {
  if (tarball) await rm(tarball, { force: true })
  await rm(temporary, { recursive: true, force: true })
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, npm_config_dry_run: 'false' },
    windowsHide: true,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error((result.stderr || result.stdout).trim())
  return result.stdout.trim()
}
