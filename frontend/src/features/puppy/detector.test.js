import { describe, expect, test } from 'vitest'
import { ALERT_GAP_MS, OWN_ACTION_MS, createAlertGate, detectNew, initialDetector } from './detector.js'

const n = (id, extra = {}) => ({ id, type: 'OVER_40H', created_at: '2026-10-15T09:00:00Z', subject_user: { id: 'u-eli' }, ...extra })
const ME = 'u-me'

/** Feed polls one after another; returns how many new notifications each poll found. */
function run(polls, options = {}) {
  let state = initialDetector()
  return polls.map((items) => {
    const result = detectNew(state, items, { me: ME, now: 10000, ...options })
    state = result.state
    return result.fresh.length
  })
}

describe('new-notification detector', () => {
  test('the first load is silent, however many unread notifications are waiting', () => {
    expect(run([[n('a'), n('b'), n('c')]])).toEqual([0])
  })

  test('a poll before the data has loaded changes nothing and does not count as the first load', () => {
    expect(run([undefined, [n('a')], [n('a'), n('b')]])).toEqual([0, 0, 1])
  })

  test('new notifications on a later poll are reported once', () => {
    expect(run([[n('a')], [n('a'), n('b'), n('c')], [n('a'), n('b'), n('c')]])).toEqual([0, 2, 0])
  })

  test('reading notifications (the count going down) is never new', () => {
    expect(run([[n('a'), n('b')], [n('a')], []])).toEqual([0, 0, 0])
  })

  test('one read and one new in the same poll still counts the new one', () => {
    expect(run([[n('a')], [n('b')]])).toEqual([0, 1])
  })

  test('a refreshed message alert (same id, newer time) counts as new: someone wrote again', () => {
    const later = { created_at: '2026-10-15T10:00:00Z' }
    expect(run([[n('m', { type: 'MESSAGE_RECEIVED' })], [n('m', { type: 'MESSAGE_RECEIVED', ...later })]])).toEqual([0, 1])
  })

  test("what your own save reports (auto-routing, a finalized plan) stays silent, so the save's toast stays", () => {
    let state = detectNew(initialDetector(), [], { me: ME }).state
    const result = detectNew(state, [n('a', { type: 'AUTO_ROUTED', subject_user: { id: 'u-ben' } })],
      { me: ME, now: 5000, ownActionAt: 4000 })
    expect(result.fresh).toEqual([])
    state = result.state
    const later = detectNew(state, [n('b', { type: 'AUTO_ROUTED', subject_user: { id: 'u-ben' } })],
      { me: ME, now: 60000, ownActionAt: 60000 - OWN_ACTION_MS - 1 })
    expect(later.fresh.map((x) => x.id)).toEqual(['b'])
  })

  test('your own action is not news: an alert about you right after your own save stays silent', () => {
    let state = detectNew(initialDetector(), [], { me: ME, now: 0 }).state
    const own = detectNew(state, [n('x', { subject_user: { id: ME } })], { me: ME, now: 5000, ownActionAt: 4000 })
    expect(own.fresh).toEqual([])
    state = own.state
    // Someone else's alert arriving in the same refresh is still news.
    const mixed = detectNew(state, [n('x', { subject_user: { id: ME } }), n('y')], { me: ME, now: 5200, ownActionAt: 4000 })
    expect(mixed.fresh.map((f) => f.id)).toEqual(['y'])
  })

  test('an alert about you long after your last save is news (a manager rejected your hours)', () => {
    const state = detectNew(initialDetector(), [], { me: ME, now: 0 }).state
    const later = detectNew(state, [n('r', { type: 'ENTRY_REJECTED', subject_user: { id: ME } })],
      { me: ME, now: 60000, ownActionAt: 60000 - OWN_ACTION_MS - 1 })
    expect(later.fresh.map((f) => f.id)).toEqual(['r'])
  })
})

describe('alert gate (never more than once per 5 seconds)', () => {
  test('the first alert plays straight away', () => {
    const gate = createAlertGate()
    expect(gate.offer(1, 0)).toEqual({ play: 1 })
  })

  test('alerts inside the gap wait, are added together and play once when the gap ends', () => {
    const gate = createAlertGate()
    gate.offer(1, 0)
    expect(gate.offer(2, 1000)).toEqual({ wait: ALERT_GAP_MS - 1000 })
    expect(gate.offer(1, 3000)).toEqual({ wait: ALERT_GAP_MS - 3000 })
    expect(gate.flush(ALERT_GAP_MS)).toEqual({ play: 3 })
    expect(gate.flush(ALERT_GAP_MS + 10)).toEqual(null)
  })

  test('a flush that comes too early keeps waiting', () => {
    const gate = createAlertGate()
    gate.offer(1, 0)
    gate.offer(1, 100)
    expect(gate.flush(4000)).toEqual({ wait: ALERT_GAP_MS - 4000 })
    expect(gate.flush(5000)).toEqual({ play: 1 })
  })

  test('after the gap a new alert plays straight away again', () => {
    const gate = createAlertGate()
    gate.offer(1, 0)
    expect(gate.offer(1, ALERT_GAP_MS)).toEqual({ play: 1 })
    expect(gate.offer(0, ALERT_GAP_MS * 3)).toEqual(null)
  })
})
