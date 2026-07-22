import { output } from './output.js'

export function buildStatus({ config, controller, pageCount, paths, runtime, runtimeError, state }, cliVersion) {
  const connected = Boolean(state.running && controller?.running)
  return {
    cliVersion,
    agent: {
      installed: state.installed,
      running: state.running,
      pid: state.pid || null,
    },
    antigravity: {
      connected,
      pages: pageCount,
    },
    config: {
      mode: controller?.mode || config.mode,
      maxClicksPerMinute: controller?.maxRetriesPerMinute || config.maxRetriesPerMinute,
      autoContinue: config.autoContinue,
      requireFocus: config.requireFocus,
    },
    activity: controller ? {
      totalClicks: controller.totalClicks,
      retryClicks: controller.retryClicks,
      continueClicks: controller.continueClicks,
      clicksLastMinute: controller.clicksLastMinute,
    } : null,
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
      scanCount: controller.scanCount,
      minimumClickIntervalMs: controller.minimumClickIntervalMs,
      leaseUntil: controller.leaseUntil,
    } : null,
  }
}

export function printStatus(status, verbose) {
  output.title('Retrynaut', status.cliVersion)
  output.blank()
  output.section('Agent')

  let agentState
  if (!status.agent.installed) agentState = output.yellow('Not installed')
  else if (status.agent.running) {
    agentState = `${output.green('Running')} ${output.dim(`· pid ${status.agent.pid}`)}`
  } else agentState = output.yellow('Stopped')

  let connection
  if (!status.agent.running) connection = output.dim('Inactive')
  else if (status.antigravity.connected) connection = output.green('Connected')
  else connection = output.yellow('Waiting')

  const rows = [
    ['Status', agentState],
    ['Antigravity', connection],
  ]
  if (status.agent.installed) {
    rows.push(
      ['Mode', modeLabel(status.config.mode)],
      ['Auto-continue', status.config.autoContinue ? output.green('Enabled') : 'Disabled'],
      ['Click limit', `${status.config.maxClicksPerMinute} per minute`],
    )
  }
  output.rows(rows)

  if (status.activity) {
    output.blank()
    output.section('Activity — this session')
    output.rows([
      ['Retries', status.activity.retryClicks],
      ['Continues', status.activity.continueClicks],
      ['Last minute', `${status.activity.clicksLastMinute} of ${status.config.maxClicksPerMinute}`],
    ])
  }

  if (status.installation) {
    output.blank()
    output.section('Installation')
    const runtimeVersion = status.installation.version || output.yellow('Unknown')
    const installRows = [
      ['Runtime', runtimeVersion],
      ['Installed', formatDate(status.installation.installedAt)],
    ]
    if (verbose) {
      installRows.push(
        ['Node', status.installation.nodePath || 'Unknown'],
        ['Runtime files', status.installation.runtimeDir],
        ['Startup', status.installation.startup],
      )
    }
    output.rows(installRows)
    if (status.installation.error) output.warning(status.installation.error)
  }

  if (verbose && status.diagnostics) {
    output.blank()
    output.section('Diagnostics')
    output.rows([
      ['Controller', status.diagnostics.controllerVersion],
      ['Scans', status.diagnostics.scanCount],
      ['Minimum interval', `${status.diagnostics.minimumClickIntervalMs} ms`],
      ['Lease until', formatDate(status.diagnostics.leaseUntil)],
    ])
  }

  if (!status.agent.installed) {
    output.blank()
    output.warning('Run `retrynaut install` to enable background retries.')
  } else if (!status.agent.running) {
    output.blank()
    output.warning('Run `retrynaut start` to resume background retries.')
  } else if (!status.antigravity.connected) {
    output.blank()
    output.warning('Open Antigravity; Retrynaut will connect automatically.')
  }
}

export function modeLabel(mode) {
  return {
    'high-traffic-only': 'High traffic only',
    'agent-errors': 'Agent errors',
    all: 'All recognized errors',
  }[mode] || mode
}

function formatDate(value) {
  if (!value) return 'Unknown'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown'
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}
