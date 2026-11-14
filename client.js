/**
 * Browser half of dsh-favicon-status.
 *
 * Paints the tab favicon from the shared Session status:
 *   red     — a Session's latest turn broke and you have not opened it since
 *   yellow  — a Session waits on you (approval, question, plan review)
 *   green   — a Session finished successfully while you were elsewhere
 *   loading — Sessions are running and none of the above applies
 *   idle    — the original favicon, restored untouched
 * Priority: red > yellow > green > loading > idle.
 */
window.__ModuleLoader__.load({
  id: 'dsh-favicon-status',
  factory() {
    const PROJECTION_KEY = 'faviconTurnOutcome'
    const STORAGE_KEY = 'dsh-favicon-status.ack.v1'
    const LINK_ID = 'dsh-favicon-status'
    const SIZE = 64
    const COLORS = { red: '#e5484d', yellow: '#f5b301', green: '#30a46c', loading: '#3e8cf0' }
    const FRAME_MS = 120
    const FRAMES = 12

    // ---------- pure state ----------

    /** Top-level, non-blank Sessions that the Host lists. */
    function visibleSessions(list) {
      const out = []
      for (const id of list.ids ?? []) {
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

    /**
     * Derive the favicon state and the acknowledgements to record.
     * @param list - Session list snapshot.
     * @param statuses - unified Session status map.
     * @param acks - Session id → acknowledged failure seq.
     * @returns `{ kind, counts, ack }`, where `ack` lists failures the user is looking at now.
     */
    function summarize(list, statuses, acks) {
      const counts = { red: 0, yellow: 0, green: 0, running: 0 }
      const ack = []
      for (const row of visibleSessions(list)) {
        const status = statuses.get(row.id)
        const outcome = outcomeOf(list, row.id)
        const running = status?.running ?? row.running
        let broken = false
        if (outcome !== null && !running) {
          if (isMain(row)) {
            if ((acks[row.id] ?? -1) < outcome.seq) ack.push([row.id, outcome.seq])
          } else if ((acks[row.id] ?? -1) < outcome.seq) {
            broken = true
          }
        }
        if (broken) counts.red++
        else if (status?.pendingInteraction !== undefined) counts.yellow++
        else if (status?.completionUnread === true && outcome === null) counts.green++
        if (running) counts.running++
      }
      const kind = counts.red > 0 ? 'red'
        : counts.yellow > 0 ? 'yellow'
          : counts.green > 0 ? 'green'
            : counts.running > 0 ? 'loading'
              : 'idle'
      return { kind, counts, ack }
    }

    /** Badge count shown inside the dot. */
    function countFor(summary) {
      const n = summary.kind === 'loading' ? 0 : summary.counts[summary.kind] ?? 0
      return n > 9 ? '9+' : n > 1 ? String(n) : ''
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

    // ---------- drawing ----------

    let baseImage = null
    let baseHref = ''

    function pickOriginalHref(links) {
      const dark = globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches === true
      const match = links.find(link => {
        const media = link.getAttribute('media')
        return media === null || globalThis.matchMedia?.(media).matches !== false
      })
      return (match ?? links[0])?.href ?? (dark ? '/favicon-dark.svg' : '/favicon.svg')
    }

    function loadBase(href, onReady) {
      if (href === baseHref && baseImage !== null) return
      baseHref = href
      const image = new Image()
      image.onload = () => { if (baseHref === href) { baseImage = image; onReady() } }
      image.onerror = () => { if (baseHref === href) baseImage = null }
      image.src = href
    }

    function draw(kind, label, frame) {
      const canvas = document.createElement('canvas')
      canvas.width = SIZE
      canvas.height = SIZE
      const c = canvas.getContext('2d')
      if (c === null) return null
      const color = COLORS[kind]
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
        c.fillStyle = globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? '#1c1c1e' : '#ffffff'
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
      let timer = undefined
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

      function stopTimer() {
        if (timer !== undefined) { clearInterval(timer); timer = undefined }
      }

      function repaint() {
        if (link === null || current.kind === 'idle') return
        const url = draw(current.kind, current.label, frame)
        if (url !== null) link.href = url
      }

      function show(kind, label) {
        if (kind === current.kind && label === current.label) return
        current = { kind, label }
        if (kind === 'idle') { release(); return }
        takeOver()
        if (kind === 'loading') {
          if (timer === undefined) {
            timer = setInterval(() => { frame = (frame + 1) % FRAMES; repaint() }, FRAME_MS)
          }
        } else {
          stopTimer()
        }
        repaint()
      }

      return { show, release, repaint }
    }

    const internals = { summarize, countFor, visibleSessions }
    if (typeof globalThis.__dshFaviconStatusTestHook === 'function') globalThis.__dshFaviconStatusTestHook(internals)

    return {
      inject: ['sessions', 'uiSession'],
      apply(ctx) {
        const painter = createPainter()
        let acks = readAcks()
        let initialized = acks !== null
        if (acks === null) acks = {}

        const update = () => {
          const list = ctx.sessions.list.getSnapshot()
          const statuses = ctx.uiSession.sessionStatus.getSnapshot()
          if (!initialized) {
            // First run on this browser: treat breaks that already exist as seen.
            if (list.phase !== 'ready') return
            for (const row of visibleSessions(list)) {
              const outcome = outcomeOf(list, row.id)
              if (outcome !== null) acks[row.id] = outcome.seq
            }
            initialized = true
            writeAcks(acks)
          }
          const summary = summarize(list, statuses, acks)
          if (summary.ack.length > 0) {
            for (const [id, seq] of summary.ack) acks[id] = seq
            writeAcks(acks)
          }
          painter.show(summary.kind, countFor(summary))
        }

        ctx.effect(() => {
          const offList = ctx.sessions.list.subscribe(update)
          const offStatus = ctx.uiSession.sessionStatus.subscribe(update)
          const media = globalThis.matchMedia?.('(prefers-color-scheme: dark)')
          const onScheme = () => { baseImage = null; baseHref = ''; painter.release(); update() }
          media?.addEventListener?.('change', onScheme)
          update()
          return () => {
            offList()
            offStatus()
            media?.removeEventListener?.('change', onScheme)
            painter.release()
          }
        }, 'dsh-favicon-status')
      },
    }
  },
})
