(() => {
  const VERSION = 3
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
  const seededClicks = Array.isArray(globalThis.__retrynautClickSeed)
    ? globalThis.__retrynautClickSeed.filter((value) => Number.isFinite(value))
    : []
  delete globalThis.__retrynautClickSeed
  const recentClicks = seededClicks
  const scheduledButtons = new WeakSet()
  const leaseDurationMs = 10_000

  let running = false
  let observer
  let scanTimer
  let fallbackTimer
  let leaseTimer
  let leaseUntil = 0
  let stoppedByLease = false
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

  function matchCurrentArticle(patterns) {
    const articles = [...document.querySelectorAll('[role="article"]')]
    for (let index = articles.length - 1; index >= 0; index -= 1) {
      const article = articles[index]
      if (!isVisible(article)) continue
      const rect = article.getBoundingClientRect()
      if (rect.bottom <= 0 || rect.right <= 0
          || rect.top >= innerHeight || rect.left >= innerWidth) continue

      const text = article.textContent || ''
      if (text.length > 2_000) return null
      return patterns.find((pattern) => pattern.regex.test(text)) || null
    }
    return null
  }

  function matchSeparatedRetry(button, patterns) {
    const terminated = retryPatterns.find((pattern) => pattern.name === 'agent terminated')
    if (!terminated || !matchContext(button, [terminated])) return null
    return matchCurrentArticle(patterns)
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
          || matchSeparatedRetry(button, activeRetryPatterns)
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
      globalThis.__retrynautReportClick?.(String(now))
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

  function renewLease() {
    leaseUntil = Date.now() + leaseDurationMs
  }

  function stopController(reason) {
    stoppedByLease = reason === 'lease'
    running = false
    observer?.disconnect()
    observer = undefined
    clearTimeout(scanTimer)
    clearInterval(fallbackTimer)
    clearInterval(leaseTimer)
    scanTimer = undefined
    fallbackTimer = undefined
    leaseTimer = undefined
    return controller.status()
  }

  const controller = {
    version: VERSION,
    start() {
      renewLease()
      stoppedByLease = false
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
      leaseTimer = setInterval(() => {
        if (Date.now() > leaseUntil) stopController('lease')
      }, 1_000)
      scheduleScan()
      console.info(`[Retrynaut] Started in ${CONFIG.mode} mode.`)
      return this.status()
    },
    stop() {
      return stopController('manual')
    },
    heartbeat() {
      renewLease()
      if (stoppedByLease) return this.start()
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
    history() {
      pruneClicks()
      return [...recentClicks]
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
        leaseUntil,
      }
    },
  }

  globalThis.retrynaut = controller
  controller.start()
})()
