import { readFile } from 'node:fs/promises'

const marker = '__RETRYNAUT_CONFIG__'
const source = await readFile(new URL('./retry.js', import.meta.url), 'utf8')

export function buildScript(config) {
  if (!source.includes(marker)) throw new Error('retry script is missing its config marker')
  return source.replace(marker, JSON.stringify(config))
}
