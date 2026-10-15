// Timer arithmetic for the screen. The server owns the clock (backend app/features/time/timers.py): it says when the
// timer started and what time it is, so the elapsed time shown never depends on the device's clock being right.

/** Milliseconds to add to this device's clock to get the server's (from GET /timers/current's `now`). */
export function clockOffset(serverNow, deviceNow) {
  const server = Date.parse(serverNow ?? '')
  return Number.isFinite(server) && deviceNow ? server - deviceNow : 0
}

/** Whole seconds since `startedAt` (ISO), on the server's clock; never negative. */
export function elapsedSeconds(startedAt, offset, deviceNow) {
  const start = Date.parse(startedAt ?? '')
  if (!Number.isFinite(start)) return 0
  return Math.max(0, Math.floor((deviceNow + offset - start) / 1000))
}

/** 75 → "1:15", 3725 → "1:02:05": minutes and seconds, with hours once there are any. */
export function formatElapsed(seconds) {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const pad = (n) => String(n).padStart(2, '0')
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`
}

/** The hours a stop would log now: nearest quarter hour, nothing under 7.5 minutes (the server's rule). */
export function hoursIfStopped(seconds) {
  const quarters = Math.round(seconds / 900 + 1e-9)
  return Math.min(quarters * 0.25, 24)
}

export const NOTE_MIN = 10
export const NOTE_MAX = 500

/** A work note that counts as proof of work: 10-500 characters once trimmed (backend app/rules/time_tracking.py). */
export const isProofNote = (note) => {
  const n = String(note ?? '').trim().length
  return n >= NOTE_MIN && n <= NOTE_MAX
}

/** "tracked" | "manual" | "mixed" → the chip's label. */
export const SOURCE_LABEL = { tracked: 'Tracked', manual: 'Manual', mixed: 'Mixed' }

/** Short names for the red flags the server computes (backend app/rules/hour_flags.py); tooltips carry its sentence. */
export const FLAG_LABEL = {
  SAME_HOURS_DAILY: 'Same hours daily',
  LONG_DAY: 'Long day',
  CLOSED_MILESTONE: 'Closed milestone',
  BACKDATED: 'Backdated',
  OVER_PLAN: 'Over plan',
  NO_ACTIVITY: 'No activity',
  NO_PROOF: 'No proof of work',
}

/** Share of hours that came from timers, as whole percentages that add up to 100: { tracked, manual }. */
export function trackedShare(items) {
  const hours = items.reduce((sum, i) => sum + Number(i.hours ?? 0), 0)
  if (!hours) return null
  const tracked = items.reduce((sum, i) => sum + Number(i.tracked_hours ?? 0), 0)
  const pct = Math.round((tracked / hours) * 100)
  return { tracked: pct, manual: 100 - pct }
}

/** "Tracked 68% · Manual 32%" for a set of entries ({hours, tracked_hours}), or null without hours. */
export function shareText(entries) {
  const share = trackedShare(entries)
  return share ? `Tracked ${share.tracked}% · Manual ${share.manual}%` : null
}

/** Tell the person what a stop did: hours added to the day's cell (not submitted yet), nothing, or why not. */
export function announceStop(toast, result) {
  if (!result) return
  if (result.not_logged) toast.error(result.message)
  else if (!result.added_hours) toast.info(result.message)
  else if (result.auto_stopped) toast.warning(result.message)
  else toast.success(result.message)
}

// ---------- over-limit warnings (backend app/rules/timer_limits.py) ----------
// The server sends each limit of a running timer with the moments the clock reaches 100% (warn_at) and 125%
// (over_at), so the screen changes level exactly then, between refreshes, from its own ticking clock.

/** 'ok' | 'warning' | 'over' for one limit at `serverNowMs` (the device clock plus the server offset). */
export function limitLevel(limit, serverNowMs) {
  const over = Date.parse(limit?.over_at ?? '')
  const warn = Date.parse(limit?.warn_at ?? '')
  if (Number.isFinite(over) && serverNowMs >= over) return 'over'
  if (Number.isFinite(warn) && serverNowMs >= warn) return 'warning'
  return 'ok'
}

/** The worst level across a timer's limits. */
export function worstLevel(limits, serverNowMs) {
  const levels = (limits ?? []).map((l) => limitLevel(l, serverNowMs))
  return levels.includes('over') ? 'over' : levels.includes('warning') ? 'warning' : 'ok'
}

/** Limits at 100% or more right now, worst first. */
export function reachedLimits(limits, serverNowMs) {
  return (limits ?? []).filter((l) => limitLevel(l, serverNowMs) !== 'ok')
}

export const LIMIT_LABEL = { daily: '8h day', milestone: 'Estimate', weekly: '40h week' }
export const LEVEL_CHIP = { warning: { label: 'Warning', color: 'warning' }, over: { label: 'Over', color: 'error' } }

/** "1h 20m" / "45m" for a number of seconds. */
export function formatDuration(seconds) {
  const minutes = Math.max(0, Math.floor(seconds / 60))
  const h = Math.floor(minutes / 60)
  return h ? `${h}h ${minutes % 60}m` : `${minutes}m`
}

/** "2026-10-13" → "Tuesday", with no timezone shift. */
export function weekdayName(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long' })
}
