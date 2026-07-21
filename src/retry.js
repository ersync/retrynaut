(() => {
  const VERSION = 1
  const CONFIG = __RETRYNAUT_CONFIG__
  const previous = globalThis.retrynaut

  if (previous?.version === VERSION && previous?.sameConfig?.(CONFIG)) {
    previous.start?.()
    return
  }
  previous?.stop?.()

  const retryPatterns = [
    { name: 'high traffic', regex: /high\s+traffic/i },
    { name: 'agent terminated', regex: /agent\s+(execution\s+)?terminated\s+due\s+to\s+error/i },
    { name: 'server error', regex: /server\s+error|internal\s+error|something\s+went\s+wrong/i },
    { name: 'rate limited', regex: /rate\s+limit(ed)?|too\s+many\s+requests/i },
    { name: 'connection error', regex: /connection\s+(error|lost|failed)|network\s+error/i },
  ]
  const continuePatterns = [
    { name: 'context limit', regex: /context\s+(window|limit)|max\s+token|output\s+limit/i },
    { name: 'agent paused', regex: /continue\s+(the\s+)?(task|agent|execution)|agent\s+paused/i },
  ]
  const activeRetryPatterns = CONFIG.mode === 'high-traffic-only'
    ? retryPatterns.filter((pattern) => pattern.name === 'high traffic')
    : CONFIG.mode === 'agent-errors'
      ? retryPatterns.filter((pattern) => pattern.name === 'agent terminated')
      : retryPatterns

  const clickWindowMs = 60_000
  const minimumClickIntervalMs = Math.max(
    250,
    Math.ceil(clickWindowMs / CONFIG.maxRetriesPerMinute),
  )
  const recentClicks = []
  const scheduledButtons = new WeakSet()

  let running = false
  let observer
  let scanTimer
  let fallbackTimer
  let lastClickAt = 0
  let totalClicks = 0
  let retryClicks = 0
  let continueClicks = 0
  let scanCount = 0

  const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim()

  function isVisible(element) {
    if (!element?.isConnected) return false
    const style = getComputedStyle(element)
    return style.display !== 'none'
      && style.visibility !== 'hidden'
      && element.getClientRects().length > 0
  }

  function isEnabled(element) {
    return !element.disabled && element.getAttribute('aria-disabled') !== 'true'
  }

  function buttonText(button) {
    return normalize(
      button.textContent
      || button.getAttribute('aria-label')
      || button.getAttribute('title'),
    ).toLowerCase()
  }

  function matchContext(button, patterns) {
    let node = button
    for (let depth = 0; node && node !== document.body && depth < 20; depth += 1) {
      const text = node.textContent || ''
      if (text.length <= 2_000) {
        const match = patterns.find((pattern) => pattern.regex.test(text))
        if (match) return match
      }
      node = node.parentElement
    }
    return null
  }

  function pruneClicks(now = Date.now()) {
    const cutoff = now - clickWindowMs
    while (recentClicks.length && recentClicks[0] <= cutoff) recentClicks.shift()
  }

  function canClick(now = Date.now()) {
    pruneClicks(now)
    return recentClicks.length < CONFIG.maxRetriesPerMinute
      && now - lastClickAt >= minimumClickIntervalMs
  }

  function findAction() {
    for (const button of document.querySelectorAll('button, [role="button"]')) {
      if (!isVisible(button) || !isEnabled(button)) continue
      const text = buttonText(button)
      if (text === 'retry' || text === 'try again') {
        const pattern = matchContext(button, activeRetryPatterns)
        if (pattern) return { button, pattern, kind: 'retry' }
      }
      if (CONFIG.autoContinue && text === 'continue') {
        const pattern = matchContext(button, continuePatterns)
        if (pattern) return { button, pattern, kind: 'continue' }
      }
    }
    return null
  }

  function scan() {
    scanTimer = undefined
    scanCount += 1
    if (!running || (CONFIG.requireFocus && !document.hasFocus()) || !canClick()) return

    const action = findAction()
    if (!action || scheduledButtons.has(action.button)) return
    scheduledButtons.add(action.button)

    setTimeout(() => {
      scheduledButtons.delete(action.button)
      const now = Date.now()
      if (!running || !action.button.isConnected || !isVisible(action.button)
          || !isEnabled(action.button) || !canClick(now)) return

      const current = findAction()
      if (!current || current.button !== action.button) return

      lastClickAt = now
      recentClicks.push(now)
      totalClicks += 1
      if (action.kind === 'retry') retryClicks += 1
      else continueClicks += 1
      console.info(
        `[Retrynaut] ${action.kind} #${totalClicks}`
        + ` (${recentClicks.length}/${CONFIG.maxRetriesPerMinute} this minute, ${action.pattern.name}).`,
      )
      action.button.click()
    }, CONFIG.retryDelayMs)
  }

  function scheduleScan() {
    if (!running || scanTimer !== undefined) return
    scanTimer = setTimeout(scan, 120)
  }

  const controller = {
    version: VERSION,
    start() {
      if (running) return this.status()
      running = true
      observer = new MutationObserver(scheduleScan)
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
        attributeFilter: ['disabled', 'aria-disabled'],
      })
      fallbackTimer = setInterval(scheduleScan, CONFIG.scanIntervalMs)
      scheduleScan()
      console.info(`[Retrynaut] Started in ${CONFIG.mode} mode.`)
      return this.status()
    },
    stop() {
      running = false
      observer?.disconnect()
      observer = undefined
      clearTimeout(scanTimer)
      clearInterval(fallbackTimer)
      scanTimer = undefined
      fallbackTimer = undefined
      return this.status()
    },
    reset() {
      recentClicks.length = 0
      lastClickAt = 0
      return this.status()
    },
    sameConfig(other) {
      return JSON.stringify(CONFIG) === JSON.stringify(other)
    },
    status() {
      pruneClicks()
      return {
        version: VERSION,
        running,
        mode: CONFIG.mode,
        totalClicks,
        retryClicks,
        continueClicks,
        clicksLastMinute: recentClicks.length,
        maxRetriesPerMinute: CONFIG.maxRetriesPerMinute,
        minimumClickIntervalMs,
        scanCount,
      }
    },
  }

  globalThis.retrynaut = controller
  controller.start()
})()
