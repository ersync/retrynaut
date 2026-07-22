# Retrynaut

Retrynaut watches Claude runs in the Antigravity 2.x desktop app and clicks
Retry when a run fails with a `high-traffic` error. It runs locally in the
background, so the window does not need constant attention.

This edition is plain JavaScript distributed through npm. There is no compiled
Retrynaut binary and no postinstall script that downloads one.

## Install

Node.js 22 or newer is required.

Install the CLI globally, test the connection, then enable the background agent:

```bash
npm install -g retrynaut
retrynaut doctor
retrynaut install
```

If you do not want a global CLI, the same flow works through `npx`:

```bash
npx -y retrynaut@latest doctor
npx -y retrynaut@latest install
```

The installer copies the JavaScript runtime to Retrynaut's user config
directory and starts a background agent. It uses a LaunchAgent on macOS, a
Scheduled Task on Windows, and a systemd user unit on Linux with an XDG
autostart fallback. Retrynaut installs per user and does not request
administrator access. Your npm setup may still require permission to install
global packages.

## How it works

- Connects to Antigravity's Chromium debugging port on `127.0.0.1`.
- Injects the UI watcher in [`src/retry.js`](src/retry.js) into the active page
  while the background agent is connected.
- Clicks only a visible, enabled button named exactly `Retry` or `Try again`
  beside a recognized error.
- Makes no external API calls and has no telemetry.

The default mode only matches high-traffic errors. One active agent shares a
hard ceiling of 20 automatic clicks per minute across page reloads. The ceiling
also includes Continue clicks when auto-continue is enabled. Stopping the agent
also stops its injected controller; Antigravity files are never modified.

Retrynaut currently watches one matching Antigravity page at a time. If several
Antigravity windows are open, it may not watch the window containing the failed
run.

## Commands

These examples assume a global install. With `npx`, replace `retrynaut` with
`npx -y retrynaut@latest`.

```bash
retrynaut doctor
retrynaut status
retrynaut start
retrynaut stop
retrynaut configure --max-per-minute 20
retrynaut uninstall --purge
```

`doctor` checks the local debugging connection without injecting the controller
or clicking anything.

`stop` stops the current agent but leaves automatic startup enabled. `start`
brings it back immediately. `uninstall --purge` removes the background
registration, copied runtime, logs, and configuration. If the CLI was installed
globally, remove that separately with `npm uninstall -g retrynaut`.

## Configuration

```bash
# Only agent-terminated errors
retrynaut configure --mode agent-errors

# All recognized error categories
retrynaut configure --mode all

# Change the maximum rate
retrynaut configure --max-per-minute 40

# Click recognized Continue prompts too
retrynaut configure --auto-continue
```

Configuration changes restart an installed background agent automatically.
Continue is disabled by default.

## Update

With a global install:

```bash
npm update -g retrynaut
retrynaut install
```

Or install the newest runtime directly with
`npx -y retrynaut@latest install`. `retrynaut status` shows the version and Node
executable currently used by the background agent.

## From source

```bash
git clone https://github.com/ersync/retrynaut.git
cd retrynaut
npm install
npm test
node bin/retrynaut.js doctor
node bin/retrynaut.js install
```

There are no runtime dependencies and no build step.

## Notes

- Retrynaut records the Node executable used during installation. Run
  `retrynaut install` again after replacing or removing that Node version.
- Antigravity's private Electron runtime is not used. Depending on it would make
  the agent fragile across Antigravity updates.
- Retrying cannot repair expired authentication, exhausted quota, a disconnected
  network, or a permanent backend failure.
- Daily development is on macOS with Antigravity 2.3.1. Windows and Linux run
  the unit and package tests in CI, but their startup integrations are still
  early support and have less real-world use.
