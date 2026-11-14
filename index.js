/**
 * Host half of dsh-favicon-status.
 *
 * Registers one small Session projection, `faviconTurnOutcome`, that records
 * whether the Session's latest turn broke. The Client half reads it from the
 * shared Session list projections to paint the red favicon badge. The value is
 * the failed `turn/end` position and code, or `null` when the latest turn ended
 * normally, was cancelled by the user, or a new turn has started.
 */

/** Projection key carried to the browser through the Session control stream. */
export const PROJECTION_KEY = 'faviconTurnOutcome'

/** Cordis services this plugin waits for. */
export const inject = ['sessionProjections']

/**
 * Validate a stored or wire value: `null` or `{ seq, code }`.
 * The projection registry only calls `.parse`, so no schema library is needed.
 * @param {unknown} value - candidate value.
 * @returns {{ seq: number, code: string } | null} the validated value.
 */
export function parseOutcome(value) {
  if (value === null) return null
  if (typeof value === 'object' && value !== null
    && Number.isSafeInteger(value.seq) && value.seq >= 0
    && typeof value.code === 'string' && value.code.length > 0 && value.code.length <= 200) {
    return { seq: value.seq, code: value.code }
  }
  throw new TypeError('faviconTurnOutcome: expected null or { seq, code }')
}

const schema = { parse: parseOutcome }

/**
 * Failure code of a turn ending, or undefined when the ending is not a break.
 * Mirrors the conversation's own error row: recorded errors, process exits
 * mid-turn, and sign-out cancellations. A user's own Stop is not a break.
 * @param {any} reason - `turn/end` reason.
 * @returns {string | undefined} failure code.
 */
export function failureCode(reason) {
  switch (reason?.kind) {
    case 'error': {
      const code = reason.error?.code
      return typeof code === 'string' && code !== '' ? code : 'UNKNOWN'
    }
    case 'interrupted':
      return 'INTERRUPTED'
    case 'aborted':
      return reason.reason?.kind === 'hook' && reason.reason?.reason === 'deepseek-account/signed-out'
        ? 'ACCOUNT_SIGNED_OUT'
        : undefined
    default:
      return undefined
  }
}

/**
 * Pure fold over committed Session events; returns the same reference for
 * events it ignores so unchanged state costs nothing downstream.
 * @param {{ seq: number, code: string } | null} state - previous state.
 * @param {any} event - committed Session event.
 * @returns {{ seq: number, code: string } | null} next state.
 */
export function applyOutcome(state, event) {
  if (event.type === 'turn/start') return state === null ? state : null
  if (event.type !== 'turn/end') return state
  const code = failureCode(event.data?.reason)
  if (code === undefined) return state === null ? state : null
  return { seq: event.seq, code }
}

/** Projection unit definition. */
export const outcomeProjection = {
  key: PROJECTION_KEY,
  stateVersion: 1,
  stateSchema: schema,
  init: () => null,
  apply: applyOutcome,
  wire: { viewSchema: schema, view: state => state },
}

/**
 * Register the projection; the registration belongs to this plugin's fiber and
 * is released when the plugin is disabled.
 * @param {any} ctx - Host Cordis context.
 */
export async function apply(ctx) {
  await ctx.sessionProjections.register(outcomeProjection)
}
