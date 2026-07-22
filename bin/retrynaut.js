#!/usr/bin/env node

import { main } from '../src/cli.js'
import { errorOutput } from '../src/output.js'

try {
  await main(process.argv.slice(2))
} catch (error) {
  errorOutput.failure(error.message)
  process.exitCode = 1
}
