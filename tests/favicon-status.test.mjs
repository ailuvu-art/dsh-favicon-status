import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { applyOutcome, failureCode, parseOutcome, outcomeProjection } from '../index.js'

// ---------- Host projection ----------

test('turn/end error records the failure; next turn/start clears it', () => {
  let s = outcomeProjection.init()
  s = applyOutcome(s, { type: 'turn/start', seq: 1, data: {} })
  assert.equal(s, null)
  s = applyOutcome(s, { type: 'turn/end', seq: 9, data: { reason: { kind: 'error', error: { code: 'RATE_LIMIT', message: 'x' } } } })
  assert.deepEqual(s, { seq: 9, code: 'RATE_LIMIT' })
  const same = applyOutcome(s, { type: 'assistant/message', seq: 10, data: {} })
  assert.equal(same, s, 'unrelated events keep the reference')
  assert.equal(applyOutcome(s, { type: 'turn/start', seq: 11, data: {} }), null)
})

test('completed, user abort, and blocked endings are not breaks', () => {
  const failed = { seq: 3, code: 'X' }
  assert.equal(applyOutcome(failed, { type: 'turn/end', seq: 4, data: { reason: { kind: 'completed' } } }), null)
  assert.equal(failureCode({ kind: 'aborted', reason: { kind: 'user' } }), undefined)
  assert.equal(failureCode({ kind: 'blocked' }), undefined)
  assert.equal(failureCode({ kind: 'interrupted' }), 'INTERRUPTED')
  assert.equal(failureCode({ kind: 'aborted', reason: { kind: 'hook', reason: 'deepseek-account/signed-out' } }), 'ACCOUNT_SIGNED_OUT')
})

test('schema accepts null and outcome, rejects garbage', () => {
  assert.equal(parseOutcome(null), null)
  assert.deepEqual(parseOutcome({ seq: 2, code: 'E' }), { seq: 2, code: 'E' })
  assert.throws(() => parseOutcome({ seq: -1, code: 'E' }))
  assert.throws(() => parseOutcome('x'))
})

// ---------- Client summary ----------

let internals
let plugin
globalThis.__dshFaviconStatusTestHook = value => { internals = value }
globalThis.window = { __ModuleLoader__: { load: ({ factory }) => { plugin = factory() } } }
new Function(readFileSync(new URL('../client.js', import.meta.url), 'utf8'))()

function row(id, extra = {}) {
  return { id, blank: false, running: false, retainedBy: {}, ...extra }
}
function list(rows, outcomes = {}) {
  return {
    phase: 'ready',
    ids: rows.map(r => r.id),
    byId: Object.fromEntries(rows.map(r => [r.id, r])),
    projectionsBySession: Object.fromEntries(Object.entries(outcomes)
      .map(([id, v]) => [id, { values: { faviconTurnOutcome: v } }])),
  }
}
const st = (o = {}) => ({ running: false, pendingInteraction: undefined, completionUnread: false, ...o })

test('priority red > yellow > green > loading > idle', () => {
  const { summarize } = internals
  const l = list([row('a'), row('b'), row('c'), row('d')], { a: { seq: 5, code: 'E' } })
  const statuses = new Map([
    ['a', st({ completionUnread: true })],
    ['b', st({ pendingInteraction: { kind: 'question' } })],
    ['c', st({ completionUnread: true })],
    ['d', st({ running: true })],
  ])
  assert.equal(summarize(l, statuses, {}).kind, 'red')
  assert.equal(summarize(l, statuses, { a: 5 }).kind, 'yellow', 'acknowledged break drops out')
  statuses.set('b', st())
  assert.equal(summarize(l, statuses, { a: 5 }).kind, 'green')
  statuses.set('c', st())
  assert.equal(summarize(l, statuses, { a: 5 }).kind, 'loading')
  statuses.set('d', st())
  assert.equal(summarize(l, statuses, { a: 5 }).kind, 'idle')
})

test('a failed Session that stopped unread is red, not green', () => {
  const { summarize } = internals
  const l = list([row('a')], { a: { seq: 2, code: 'E' } })
  const s = summarize(l, new Map([['a', st({ completionUnread: true })]]), {})
  assert.equal(s.kind, 'red')
  assert.equal(s.counts.green, 0)
})

test('opening a broken Session acknowledges it', () => {
  const { summarize } = internals
  const l = list([row('a', { retainedBy: { mainView: 1 } })], { a: { seq: 7, code: 'E' } })
  const s = summarize(l, new Map([['a', st()]]), {})
  assert.equal(s.kind, 'idle')
  assert.deepEqual(s.ack, [['a', 7]])
})

test('loading when any Session runs; subagents and blanks ignored', () => {
  const { summarize, countFor } = internals
  const l = list([row('a', { running: true }), row('b', { running: true }), row('s', { origin: 'subagent', parentId: 'a' }), row('x', { blank: true })])
  const s = summarize(l, new Map([['s', st({ pendingInteraction: { kind: 'question' } })]]), {})
  assert.equal(s.kind, 'loading')
  assert.equal(s.counts.loading, 2)
  assert.equal(countFor(s), '')
})

test('badge count shows for several Sessions', () => {
  const { countFor } = internals
  assert.equal(countFor({ kind: 'yellow', counts: { yellow: 1 } }), '')
  assert.equal(countFor({ kind: 'yellow', counts: { yellow: 3 } }), '3')
  assert.equal(countFor({ kind: 'red', counts: { red: 12 } }), '9+')
})

test('subagent running keeps the parent loading', () => {
  const { summarize } = internals
  const l = list([row('p'), row('c', { origin: 'subagent', parentId: 'p' })])
  l.projectionsBySession.p = { values: { subagentCatalog: [{ id: 'c' }] } }
  const s = summarize(l, new Map([['c', st({ running: true })]]), {})
  assert.equal(s.kind, 'loading')
})

test('title prefix follows tab-status format', () => {
  const { prefixOf } = internals
  assert.equal(prefixOf({ kind: 'idle', counts: {} }, ''), '')
  assert.equal(prefixOf({ kind: 'yellow', counts: { yellow: 2 } }, 'Waiting'), '\u26a0 2 Waiting \u00b7 ')
  assert.equal(prefixOf({ kind: 'loading', counts: { loading: 1 } }, 'Running'), '\u25cf Running \u00b7 ')
  assert.equal(prefixOf({ kind: 'loading', counts: { loading: 3 } }, 'Running'), '\u25cf 3 Running \u00b7 ')
  assert.equal(prefixOf({ kind: 'red', counts: { red: 1 } }, 'Failed'), '\u2715 1 Failed \u00b7 ')
})

test('archived Session with failed faviconTurnOutcome does not trigger red', () => {
  const { summarize } = internals
  const l = list([row('a')], { a: { seq: 5, code: 'E' } })
  const s = summarize(l, new Map([['a', st()]]), {}, new Set(['a']))
  assert.equal(s.kind, 'idle')
  assert.deepEqual(s.counts, { red: 0, yellow: 0, green: 0, loading: 0 })
  assert.deepEqual(s.ack, [])
})

test('archived Session with pendingInteraction, completionUnread, or running does not trigger yellow, green, or loading', () => {
  const { summarize } = internals
  const l = list([
    row('y'),
    row('g'),
    row('r', { running: true }),
    row('p'),
    row('c', { origin: 'subagent', parentId: 'p' }),
  ])
  l.projectionsBySession.p = { values: { subagentCatalog: [{ id: 'c' }] } }
  const statuses = new Map([
    ['y', st({ pendingInteraction: { kind: 'approval' } })],
    ['g', st({ completionUnread: true })],
    ['r', st({ running: true })],
    ['c', st({ running: true })],
  ])
  const s = summarize(l, statuses, {}, new Set(['y', 'g', 'r', 'p']))
  assert.equal(s.kind, 'idle')
  assert.deepEqual(s.counts, { red: 0, yellow: 0, green: 0, loading: 0 })
})

test('archiving clears status and unarchiving restores it', () => {
  const { summarize } = internals
  const l = list([row('a'), row('b')], { a: { seq: 4, code: 'E' } })
  const statuses = new Map([
    ['a', st()],
    ['b', st({ pendingInteraction: { kind: 'question' } })],
  ])

  assert.equal(summarize(l, statuses, {}, new Set()).kind, 'red')
  assert.equal(summarize(l, statuses, {}, new Set(['a'])).kind, 'yellow')
  assert.equal(summarize(l, statuses, {}, new Set(['a', 'b'])).kind, 'idle')
  assert.equal(summarize(l, statuses, {}, new Set()).kind, 'red')
})

test('archived Session opened in mainView acknowledges its failure without triggering red', () => {
  const { summarize } = internals
  const l = list([row('a', { retainedBy: { mainView: 1 } })], { a: { seq: 8, code: 'E' } })
  const s = summarize(l, new Map([['a', st()]]), {}, new Set(['a']))
  assert.equal(s.kind, 'idle')
  assert.deepEqual(s.ack, [['a', 8]])
})

test('plugin injects workspaces, waits for workspaces ready on first run, and reacts to archive changes', () => {
  assert.ok(plugin.inject.includes('workspaces'))

  const makeStore = (initial) => {
    let value = initial
    const listeners = new Set()
    return {
      getSnapshot: () => value,
      subscribe: (fn) => {
        listeners.add(fn)
        return () => { listeners.delete(fn) }
      },
      set: (next) => {
        value = next
        for (const fn of listeners) fn()
      },
      listenerCount: () => listeners.size,
    }
  }

  const sessionsList = makeStore({
    phase: 'ready',
    ids: ['arch', 'live'],
    byId: {
      arch: row('arch'),
      live: row('live'),
    },
    projectionsBySession: {
      arch: { values: { faviconTurnOutcome: { seq: 10, code: 'ERR' } } },
    },
  })
  const sessionStatus = makeStore(new Map([['arch', st()], ['live', st()]]))
  const workspacesList = makeStore({ phase: 'pending', archivedSessionIds: [] })
  const localeStore = makeStore('en')

  const storage = new Map()
  const prevStorageDesc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const prevDocument = globalThis.document
  const prevMutationObserver = globalThis.MutationObserver
  const prevImage = globalThis.Image

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: k => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => { storage.set(k, v) },
    },
  })
  const titleState = { value: 'Home — DeepSeek Harness' }
  const fakeLink = { id: '', rel: '', type: '', href: '', remove() {} }
  globalThis.document = {
    get title() { return titleState.value },
    set title(v) { titleState.value = v },
    head: { appendChild() {} },
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: (tag) => tag === 'link'
      ? { ...fakeLink }
      : { width: 0, height: 0, getContext: () => null },
  }
  globalThis.Image = class {}
  globalThis.MutationObserver = class {
    observe() {}
    disconnect() {}
  }

  const cleanups = []
  const ctx = {
    sessions: { list: sessionsList },
    uiSession: { sessionStatus },
    workspaces: { list: workspacesList },
    locale: {
      bind: () => key => ({ red: 'Failed', yellow: 'Waiting', green: 'Done', loading: 'Running' }[key] ?? key),
      register: () => () => {},
      subscribe: localeStore.subscribe,
    },
    effect: (fn) => {
      const dispose = fn()
      if (typeof dispose === 'function') cleanups.push(dispose)
    },
    on: () => () => {},
  }

  try {
    plugin.apply(ctx)

    // Still pending workspaces: must not initialize acks or paint archived failure.
    assert.equal(storage.get('dsh-favicon-status.ack.v1'), undefined)
    assert.equal(titleState.value, 'Home — DeepSeek Harness')

    // Workspaces becomes ready with 'arch' archived: 'arch' must NOT be acknowledged on first run.
    workspacesList.set({ phase: 'ready', archivedSessionIds: ['arch'] })
    assert.deepEqual(JSON.parse(storage.get('dsh-favicon-status.ack.v1')), {})
    assert.equal(titleState.value, 'Home — DeepSeek Harness')

    // Unarchiving 'arch' restores its red failure state.
    workspacesList.set({ phase: 'ready', archivedSessionIds: [] })
    assert.equal(titleState.value, '\u2715 1 Failed \u00b7 Home — DeepSeek Harness')

    // Re-archiving 'arch' clears it back to idle.
    workspacesList.set({ phase: 'ready', archivedSessionIds: ['arch'] })
    assert.equal(titleState.value, 'Home — DeepSeek Harness')

    assert.equal(workspacesList.listenerCount(), 1)
    for (const fn of cleanups) fn()
    assert.equal(workspacesList.listenerCount(), 0)
  } finally {
    if (prevStorageDesc !== undefined) Object.defineProperty(globalThis, 'localStorage', prevStorageDesc)
    else delete globalThis.localStorage
    globalThis.document = prevDocument
    globalThis.MutationObserver = prevMutationObserver
    globalThis.Image = prevImage
  }
})
