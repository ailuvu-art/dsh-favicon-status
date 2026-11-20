/**
 * Browser half of dsh-favicon-status.
 *
 * Mirrors Session status onto the browser tab — the favicon and a title prefix:
 *   red     — a Session's latest turn broke and you have not opened it since
 *   yellow  — a Session waits on you (approval, question, plan review)
 *   green   — a Session finished successfully while you were elsewhere
 *   loading — Sessions (or their subagents) are running and none of the above applies
 *   idle    — the original favicon and title, restored untouched
 * Priority: red > yellow > green > loading > idle.
 *
 * Title layering is ported from @climber47/dsh-tab-status: the built-in layout
 * plugin keeps writing "<session> — DeepSeek Harness"; this plugin only layers
 * its own prefix on top and re-applies it after any foreign write.
 */
window.__ModuleLoader__.load({
  id: 'dsh-favicon-status',
  factory() {
    const PROJECTION_KEY = 'faviconTurnOutcome'
    const STORAGE_KEY = 'dsh-favicon-status.ack.v1'
    const LINK_ID = 'dsh-favicon-status'
    const NS = 'dsh-favicon-status'
    const SIZE = 64
    const FRAME_MS = 120
    const FRAMES = 12
    /** Theme token and fallback per state. */
    const COLORS = {
      red: ['--dsw-alias-state-error-primary', '#e5484d'],
      yellow: ['--dsw-alias-state-warn-primary', '#f5b301'],
      green: ['--dsw-alias-state-success-primary', '#30a46c'],
      loading: ['--dsw-alias-brand-primary', '#3e8cf0'],
    }
    const SYMBOL = { red: '\u2715 ', yellow: '\u26a0 ', green: '\u2713 ', loading: '\u25cf ' }
    const SEPARATOR = ' \u00b7 '
    const WORDS = {
      en: { red: 'Failed', yellow: 'Waiting', green: 'Done', loading: 'Running' },
      vi: { red: 'Lỗi', yellow: 'Chờ bạn', green: 'Xong', loading: 'Đang chạy' },
      'zh-CN': { red: '出错', yellow: '待处理', green: '已完成', loading: '进行中' },
    }

    // ---------- pure state ----------

    /** Top-level, non-blank, non-archived Sessions that the Host lists. */
    function visibleSessions(list, archivedIds) {
      const out = []
      for (const id of list.ids ?? []) {
        if (archivedIds?.has(id)) continue
        const row = list.byId?.[id]
        if (row === undefined || row.blank || row.origin === 'subagent' || row.parentId !== undefined) continue
        out.push(row)
      }
      return out
    }

    function outcomeOf(list, id) {
      const value = list.projectionsBySession?.[id]?.values?.[PROJECTION_KEY]
      return value !== null && typeof value === 'object' && Number.isSafeInteger(value.seq) ? value : null
    }

    function isMain(row) {
      return (row.retainedBy?.mainView ?? 0) > 0
    }

    function runningOf(list, statuses, id) {
      return statuses.get(id)?.running ?? list.byId?.[id]?.running ?? false
    }

    /** Whether the Session or any of its direct subagents is running. */
    function isWorking(list, statuses, id) {
      if (runningOf(list, statuses, id)) return true
      const children = list.projectionsBySession?.[id]?.values?.subagentCatalog
      if (!Array.isArray(children)) return false
      return children.some(child => child !== null && typeof child === 'object' && runningOf(list, statuses, child.id))
    }

    /**
     * Derive the tab state and the acknowledgements to record.
     * @param list - Session list snapshot.
     * @param statuses - unified Session status map.
     * @param acks - Session id → acknowledged failure seq.
     * @param archivedIds - optional Set of archived Session ids to exclude.
     * @returns `{ kind, counts, ack }`, where `ack` lists failures the user is looking at now.
     */
    function summarize(list, statuses, acks, archivedIds) {
      const counts = { red: 0, yellow: 0, green: 0, loading: 0 }
      const ack = []
      for (const row of visibleSessions(list, archivedIds)) {
        const status = statuses.get(row.id)
        const outcome = outcomeOf(list, row.id)
        const working = isWorking(list, statuses, row.id)
        const ownRunning = runningOf(list, statuses, row.id)
        let broken = false
        if (outcome !== null && !ownRunning && (acks[row.id] ?? -1) < outcome.seq) {
          if (isMain(row)) ack.push([row.id, outcome.seq])
          else broken = true
        }
        if (broken) counts.red++
        else if (status?.pendingInteraction !== undefined) counts.yellow++
        else if (status?.completionUnread === true && outcome === null) counts.green++
        if (working) counts.loading++
      }
      if (archivedIds !== undefined) {
        for (const id of archivedIds) {
          const row = list.byId?.[id]
          if (row === undefined || row.blank || row.origin === 'subagent' || row.parentId !== undefined) continue
          if (!isMain(row)) continue
          const outcome = outcomeOf(list, row.id)
          if (outcome !== null && !runningOf(list, statuses, row.id) && (acks[row.id] ?? -1) < outcome.seq) {
            ack.push([row.id, outcome.seq])
          }
        }
      }
      const kind = counts.red > 0 ? 'red'
        : counts.yellow > 0 ? 'yellow'
          : counts.green > 0 ? 'green'
            : counts.loading > 0 ? 'loading'
              : 'idle'
      return { kind, counts, ack }
    }

    /** Count shown inside the favicon dot; a lone Session or the spinner shows none. */
    function countFor(summary) {
      const n = summary.kind === 'loading' || summary.kind === 'idle' ? 0 : summary.counts[summary.kind]
      return n > 9 ? '9+' : n > 1 ? String(n) : ''
    }

    /**
     * Title prefix, e.g. `⚠ 2 Waiting · `. A single running Session writes no number.
     * @param summary - result of summarize.
     * @param word - localized state word.
     */
    function prefixOf(summary, word) {
      if (summary.kind === 'idle') return ''
      const n = summary.counts[summary.kind]
      const count = summary.kind === 'loading' && n <= 1 ? '' : `${n} `
      return SYMBOL[summary.kind] + count + word + SEPARATOR
    }

    // ---------- acknowledgement storage ----------

    function readAcks() {
      try {
        const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
        if (raw == null) return null
        const parsed = JSON.parse(raw)
        return parsed !== null && typeof parsed === 'object' ? parsed : {}
      } catch {
        return {}
      }
    }

    function writeAcks(acks) {
      try { globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(acks)) } catch { /* storage unavailable */ }
    }

    // ---------- title layering ----------

    function createTitle() {
      let desired = ''
      let applied = ''
      let observer = null

      function base(title) {
        return applied !== '' && title.startsWith(applied) ? title.slice(applied.length) : title
      }

      function sync() {
        const seen = document.title
        const next = desired + base(seen)
        applied = desired
        // Writing only on change keeps the observer from re-triggering itself.
        if (seen !== next) document.title = next
      }

      return {
        set(prefix) {
          if (prefix === desired && document.title.startsWith(prefix)) return
          desired = prefix
          sync()
        },
        watch() {
          const element = document.querySelector('title')
          observer = new MutationObserver(sync)
          observer.observe(element ?? document.head, { childList: true, characterData: true, subtree: true })
        },
        dispose() {
          observer?.disconnect()
          observer = null
          desired = ''
          sync()
          applied = ''
        },
      }
    }

    // ---------- drawing ----------

    let baseImage = null
    let baseHref = ''

    function isDark() {
      return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches === true
    }

    function colorOf(kind) {
      const [token, fallback] = COLORS[kind]
      try {
        const value = getComputedStyle(document.body).getPropertyValue(token).trim()
        return value === '' ? fallback : value
      } catch {
        return fallback
      }
    }

    function pickOriginalHref(links) {
      const match = links.find(link => {
        const media = link.getAttribute('media')
        return media === null || globalThis.matchMedia?.(media).matches !== false
      })
      return (match ?? links[0])?.href ?? (isDark() ? '/favicon-dark.svg' : '/favicon.svg')
    }

    function loadBase(href, onReady) {
      if (href === baseHref) return
      baseHref = href
      baseImage = null
      const image = new Image()
      image.onload = () => { if (baseHref === href) { baseImage = image; onReady() } }
      image.src = href
    }

    function draw(kind, label, frame) {
      const canvas = document.createElement('canvas')
      canvas.width = SIZE
      canvas.height = SIZE
      const c = canvas.getContext('2d')
      if (c === null) return null
      const color = colorOf(kind)
      if (kind === 'loading') {
        if (baseImage !== null) {
          try { c.drawImage(baseImage, 12, 12, 40, 40) } catch { /* undecodable */ }
        }
        c.lineWidth = 7
        c.lineCap = 'round'
        c.strokeStyle = 'rgba(128,128,128,.25)'
        c.beginPath(); c.arc(32, 32, 27, 0, Math.PI * 2); c.stroke()
        const start = (frame / FRAMES) * Math.PI * 2 - Math.PI / 2
        c.strokeStyle = color
        c.beginPath(); c.arc(32, 32, 27, start, start + Math.PI * 0.6); c.stroke()
      } else {
        if (baseImage !== null) {
          try { c.drawImage(baseImage, 0, 0, SIZE, SIZE) } catch { /* undecodable */ }
        }
        const r = label === '' ? 15 : 19
        const x = SIZE - r - 1
        const y = SIZE - r - 1
        c.beginPath(); c.arc(x, y, r + 3, 0, Math.PI * 2)
        c.fillStyle = isDark() ? '#1c1c1e' : '#ffffff'
        c.fill()
        c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2)
        c.fillStyle = color
        c.fill()
        if (label !== '') {
          c.fillStyle = kind === 'yellow' ? '#1c1c1e' : '#ffffff'
          c.font = `bold ${label.length > 1 ? 18 : 24}px system-ui, sans-serif`
          c.textAlign = 'center'
          c.textBaseline = 'middle'
          c.fillText(label, x, y + 1)
        }
      }
      try { return canvas.toDataURL('image/png') } catch { return null }
    }

    // ---------- favicon ownership ----------

    function createPainter() {
      let detached = null
      let link = null
      let timer
      let frame = 0
      let current = { kind: 'idle', label: '' }

      function originals() {
        return [...document.querySelectorAll('link[rel~="icon"]')].filter(el => el.id !== LINK_ID)
      }

      function takeOver() {
        if (link !== null) return
        detached = originals().map(el => ({ el, parent: el.parentNode, next: el.nextSibling }))
        loadBase(pickOriginalHref(detached.map(d => d.el)), () => repaint())
        for (const d of detached) d.el.remove()
        link = document.createElement('link')
        link.id = LINK_ID
        link.rel = 'icon'
        link.type = 'image/png'
        document.head.appendChild(link)
      }

      function stopTimer() {
        if (timer !== undefined) { clearInterval(timer); timer = undefined }
      }

      function release() {
        stopTimer()
        current = { kind: 'idle', label: '' }
        if (link === null) return
        link.remove()
        link = null
        for (const d of detached ?? []) {
          if (d.parent === null) continue
          d.parent.insertBefore(d.el, d.next !== null && d.next.parentNode === d.parent ? d.next : null)
        }
        detached = null
      }

      function repaint() {
        if (link === null || current.kind === 'idle') return
        const url = draw(current.kind, current.label, frame)
        if (url !== null) link.href = url
      }

      function show(kind, label) {
        if (kind === current.kind && label === current.label) return
        if (kind === 'idle') { release(); return }
        current = { kind, label }
        takeOver()
        if (kind === 'loading') {
          if (timer === undefined) timer = setInterval(() => { frame = (frame + 1) % FRAMES; repaint() }, FRAME_MS)
        } else {
          stopTimer()
        }
        repaint()
      }

      /** Redraw after colors or the base mark changed. */
      function refresh() {
        const { kind, label } = current
        release()
        baseHref = ''
        show(kind, label)
      }

      return { show, release, repaint, refresh }
    }

    const internals = { summarize, countFor, prefixOf, visibleSessions }
    if (typeof globalThis.__dshFaviconStatusTestHook === 'function') globalThis.__dshFaviconStatusTestHook(internals)

    return {
      inject: ['sessions', 'uiSession', 'locale', 'workspaces'],
      apply(ctx) {
        const painter = createPainter()
        const title = createTitle()
        const t = ctx.locale.bind(NS)
        let acks = readAcks()
        let initialized = acks !== null
        if (acks === null) acks = {}

        const update = () => {
          const list = ctx.sessions.list.getSnapshot()
          const statuses = ctx.uiSession.sessionStatus.getSnapshot()
          const workspaces = ctx.workspaces.list.getSnapshot()
          if (list.phase !== 'ready' || workspaces.phase !== 'ready') return
          const archivedIds = new Set(workspaces.archivedSessionIds ?? [])
          if (!initialized) {
            // First run on this browser: treat breaks that already exist as seen.
            for (const row of visibleSessions(list, archivedIds)) {
              const outcome = outcomeOf(list, row.id)
              if (outcome !== null) acks[row.id] = outcome.seq
            }
            initialized = true
            writeAcks(acks)
          }
          const summary = summarize(list, statuses, acks, archivedIds)
          if (summary.ack.length > 0) {
            for (const [id, seq] of summary.ack) acks[id] = seq
            writeAcks(acks)
          }
          painter.show(summary.kind, countFor(summary))
          title.set(summary.kind === 'idle' ? '' : prefixOf(summary, t(summary.kind)))
        }

        ctx.effect(() => ctx.locale.register(NS, WORDS), 'dsh-favicon-status.locale')
        ctx.on('theme/change', () => { painter.refresh() })
        ctx.effect(() => {
          title.watch()
          const offs = [
            ctx.sessions.list.subscribe(update),
            ctx.uiSession.sessionStatus.subscribe(update),
            ctx.locale.subscribe(update),
            ctx.workspaces.list.subscribe(update),
          ]
          const media = globalThis.matchMedia?.('(prefers-color-scheme: dark)')
          const onScheme = () => { painter.refresh() }
          media?.addEventListener?.('change', onScheme)
          update()
          return () => {
            for (const off of offs) off()
            media?.removeEventListener?.('change', onScheme)
            painter.release()
            title.dispose()
          }
        }, 'dsh-favicon-status')
      },
    }
  },
})
