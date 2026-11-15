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
globalThis.__dshFaviconStatusTestHook = value => { internals = value }
globalThis.window = { __ModuleLoader__: { load: ({ factory }) => factory() } }
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
