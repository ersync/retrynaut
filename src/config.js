export const modes = new Set(['all', 'agent-errors', 'high-traffic-only'])

export function defaultConfig() {
  return {
    maxRetriesPerMinute: 20,
    mode: 'high-traffic-only',
    autoContinue: false,
    requireFocus: false,
    retryDelayMs: 500,
    scanIntervalMs: 250,
  }
}

export function validateConfig(config) {
  if (!Number.isInteger(config.maxRetriesPerMinute)
      || config.maxRetriesPerMinute < 1
      || config.maxRetriesPerMinute > 120) {
    throw new Error('maxRetriesPerMinute must be an integer between 1 and 120')
  }
  if (!modes.has(config.mode)) {
    throw new Error(`unknown retry mode: ${config.mode}`)
  }
  if (!Number.isInteger(config.retryDelayMs)
      || config.retryDelayMs < 0
      || config.retryDelayMs > 30_000) {
    throw new Error('retryDelayMs must be an integer between 0 and 30000')
  }
  if (!Number.isInteger(config.scanIntervalMs)
      || config.scanIntervalMs < 100
      || config.scanIntervalMs > 60_000) {
    throw new Error('scanIntervalMs must be an integer between 100 and 60000')
  }
  return config
}
