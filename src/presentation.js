import { output } from './output.js'

export function buildStatus({ config, controller, pageCount, paths, runtime, runtimeError, state }, cliVersion) {
  const connected = Boolean(state.running && controller)
  const limit = controller?.maxRetriesPerMinute
    || state.retry?.limit
    || config.maxRetriesPerMinute
  const clicksLastMinute = controller?.clicksLastMinute
    ?? state.retry?.clicksLastMinute
    ?? 0
  const tripped = controller?.tripped ?? state.retry?.tripped ?? false
  return {
    cliVersion,
    agent: {
      installed: state.installed,
      startupEnabled: state.startupEnabled,
      running: state.running,
      pid: state.pid || null,
    },
    antigravity: {
      connected,
      pages: pageCount,
    },
    config: {
      mode: controller?.mode || config.mode,
      maxClicksPerMinute: limit,
      requireFocus: config.requireFocus,
    },
    activity: controller ? {
      retryClicks: controller.retryClicks,
      clicksLastMinute: controller.clicksLastMinute,
    } : null,
    retryLimit: {
      reached: tripped,
      clicksLastMinute,
      limit,
    },
    installation: state.installed ? {
      version: runtime?.version || null,
      installedAt: runtime?.installedAt || null,
      nodePath: runtime?.nodePath || null,
      runtimeDir: paths.runtimeDir,
      startup: paths.registration,
      error: runtimeError || null,
    } : null,
    diagnostics: controller ? {
      controllerVersion: controller.version,
      controllerRunning: controller.running,
      scanCount: controller.scanCount,
      minimumClickIntervalMs: controller.minimumClickIntervalMs,
      leaseUntil: controller.leaseUntil,
    } : null,
  }
}

export function printStatus(status, verbose, printer = output) {
  printer.title('Retrynaut', status.cliVersion)
  printer.blank()

  let automaticRetry
  if (status.agent.running) automaticRetry = printer.green('On')
  else if (status.agent.startupEnabled) automaticRetry = printer.red('Error')
  else automaticRetry = printer.yellow('Off')

  const fields = [['Automatic retry', automaticRetry]]
  if (status.agent.running) {
    fields.push(
      ['Antigravity', status.antigravity.connected
        ? printer.green('Connected')
        : printer.yellow('Waiting')],
      ['Mode', sentenceCase(modeLabel(status.config.mode))],
    )
    if (verbose) {
      const session = status.activity ? `${status.activity.retryClicks} this session · ` : ''
      fields.push([
        'Retries',
        `${session}${status.retryLimit.clicksLastMinute}/${status.retryLimit.limit} last minute`,
      ])
    }
    if (status.retryLimit.reached) fields.push(['Retry limit', printer.yellow('Cooling down')])
  }
  printer.fields(fields)

  if (status.retryLimit.reached) {
    printer.blank()
    printer.warning('Retry limit reached. Retrying resumes automatically.')
  } else if (!status.agent.installed) {
    printer.blank()
    printer.warning('Run `retrynaut install` to enable background retries.')
  } else if (status.agent.startupEnabled && !status.agent.running) {
    printer.blank()
    printer.failure('Startup is enabled, but the background agent is not running.')
  }

  if (verbose && status.installation) {
    printer.blank()
    printer.section('Details')
    printer.rows([
      ['PID', status.agent.pid || 'none'],
      ['Startup at sign-in', status.agent.startupEnabled ? 'enabled' : 'disabled'],
      ['Antigravity pages', status.antigravity.pages],
      ['Runtime', status.installation.version || 'unknown'],
      ['Installed', formatDate(status.installation.installedAt)],
      ['Node', status.installation.nodePath || 'unknown'],
      ['Runtime files', status.installation.runtimeDir],
      ['Startup', status.installation.startup],
    ])
    if (status.installation.error) printer.warning(status.installation.error)
  }

  if (verbose && status.diagnostics) {
    printer.blank()
    printer.section('Diagnostics')
    printer.rows([
      ['Controller', status.diagnostics.controllerVersion],
      ['Controller state', status.diagnostics.controllerRunning ? 'running' : 'stopped'],
      ['Scans', status.diagnostics.scanCount],
      ['Minimum interval', `${status.diagnostics.minimumClickIntervalMs} ms`],
      ['Lease until', formatDate(status.diagnostics.leaseUntil)],
    ])
  }
}

export function modeLabel(mode) {
  return {
    'high-traffic-only': 'high traffic only',
    'agent-errors': 'agent errors',
    all: 'all recognized errors',
  }[mode] || mode
}

function sentenceCase(value) {
  return value ? value[0].toUpperCase() + value.slice(1) : value
}

function formatDate(value) {
  if (!value) return 'unknown'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'unknown'
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}
