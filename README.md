# Retrynaut

Retrynaut watches the Antigravity v2 desktop app and clicks Retry when a model
run fails with a high-traffic error. It runs locally in the background, so the
window does not need constant attention.

This edition is plain JavaScript distributed through npm. There is no compiled
Retrynaut binary and no postinstall script that downloads one.

## Install

Node.js 22 or newer is required.

One command:

```bash
npx -y retrynaut install
```

Or keep the CLI available globally:

```bash
npm install -g retrynaut
retrynaut install
```

The installer copies the JavaScript runtime to Retrynaut's user config
directory and starts a background agent. It uses a LaunchAgent on macOS, a
Scheduled Task on Windows, and a systemd user unit on Linux with an XDG
autostart fallback. Administrator access is not needed.

## How it works

- Connects to Antigravity's Chromium debugging port on `127.0.0.1`.
- Loads the UI watcher in [`src/retry.js`](src/retry.js).
- Clicks only a visible, enabled button named exactly `Retry` or `Try again`
  beside a recognized error.
- Makes no external API calls and has no telemetry.

The default mode only matches high-traffic errors and allows at most 20 clicks
per minute. It does not modify Antigravity files.

## Commands

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

`stop` pauses Retrynaut until the next sign-in. `start` brings it back
immediately. `uninstall --purge` removes the background registration, copied
runtime, logs, and configuration. If the CLI was installed globally, remove
that separately with `npm uninstall -g retrynaut`.

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
- Daily development is on macOS with Antigravity 2.3.1. Windows and Linux are
  covered by CI but have less real-world use.
