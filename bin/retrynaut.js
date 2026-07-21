#!/usr/bin/env node

import { main } from '../src/cli.js'

try {
  await main(process.argv.slice(2))
} catch (error) {
  console.error(`error: ${error.message}`)
  process.exitCode = 1
}
