// When does a notification count as "new" (worth a sound, a toast and an announcement)? Pure, so every rule is tested.
//
// - The first load is silent: whatever was already waiting isn't news.
// - Afterwards, a notification is new the first time its id + created_at is seen. Reading notifications never is,
//   and one read + one arrived in the same poll still finds the arrival. A message alert is refreshed in place
//   (same id, newer time) when someone writes again, so that counts as new too.
// - Your own actions aren't news: an alert about you (subject = you) that turns up within a few seconds of a save
//   you made stays silent. The same alert type arriving later (a manager rejected your hours) is news.
// - Neither is the result your save reports itself: auto-routing after a completion, support routing and a finalized
//   plan (OWN_RESULT_TYPES) that turn up within those seconds already have the save's own toast, which Puppy's toast
//   would replace. They stay in the bell.

export const OWN_ACTION_MS = 5000
export const OWN_RESULT_TYPES = new Set(['AUTO_ASSIGNED', 'AUTO_ROUTED', 'NO_QUALIFIED_PERSON', 'SUPPORT_ASSIGNED',
  'SUPPORT_ROUTED', 'PLAN_FINALIZED'])
export const ALERT_GAP_MS = 5000

export const initialDetector = () => ({ primed: false, seen: new Set() })

const keyOf = (n) => `${n.id}@${n.created_at ?? ''}`

/** (state, unread notifications or undefined while loading, {me, now, ownActionAt}) → {state, fresh}. */
export function detectNew(state, notifications, { me, now = Date.now(), ownActionAt = -Infinity } = {}) {
  if (!Array.isArray(notifications)) return { state, fresh: [] }
  const seen = new Set(notifications.map(keyOf))
  if (!state.primed) return { state: { primed: true, seen }, fresh: [] }
  const ownMoment = now - ownActionAt <= OWN_ACTION_MS
  const fresh = notifications.filter((n) => !state.seen.has(keyOf(n))
    && !(ownMoment && ((me != null && String(n.subject_user?.id) === String(me)) || OWN_RESULT_TYPES.has(n.type))))
  return { state: { primed: true, seen }, fresh }
}

/**
 * Rate limit: at most one alert per `gap` ms. offer(count, now) answers {play: n} (go now), {wait: ms} (call
 * flush after that long; the counts add up meanwhile) or null (nothing to do). flush(now) is the same answer
 * for what has been waiting.
 */
export function createAlertGate(gap = ALERT_GAP_MS) {
  let last = -Infinity
  let pending = 0
  const answer = (now) => {
    if (!pending) return null
    if (now - last >= gap) {
      const play = pending
      pending = 0
      last = now
      return { play }
    }
    return { wait: last + gap - now }
  }
  return {
    offer(count, now) {
      pending += Math.max(count, 0)
      return answer(now)
    },
    flush: answer,
  }
}
