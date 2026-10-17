// The rules of "Log hours manually", mirrored from the backend so the pop-up can say what is wrong before the
// server does. The server re-checks everything.
import { addDays, formatDayShort } from '../../lib/format.js'
import { NOTE_MIN } from './timerClock.js'

export const REASONS = [['forgot_timer', 'Forgot to start the timer'], ['away_from_computer', 'Worked away from the computer'],
  ['meeting_or_call', 'Meeting or call'], ['timer_problem', 'Timer problem'], ['other', 'Other']]
export const WINDOW_DAYS = 7
export const DETAILS_MIN = 10
export const DETAILS_MAX = 500

const HOURS_TEXT = /^\d{1,2}(\.\d{1,2})?$/

/** Today and the 7 days before, newest first: [{ value: '2026-10-15', label: 'Today, Thu 15 Oct' }, ...]. */
export function dayOptions(today) {
  return Array.from({ length: WINDOW_DAYS + 1 }, (_, back) => {
    const value = addDays(today, -back)
    const prefix = back === 0 ? 'Today, ' : back === 1 ? 'Yesterday, ' : ''
    return { value, label: `${prefix}${formatDayShort(value)}` }
  })
}

/** Whether a day (YYYY-MM-DD) is today or one of the 7 days before it. */
export const inWindow = (day, today) => day <= today && day >= addDays(today, -WINDOW_DAYS)

/** What is wrong with the hours text, or null: 0.25 to 24 in quarter hours. */
export function hoursProblem(text) {
  const value = Number(text)
  if (!HOURS_TEXT.test(text) || value < 0.25 || value > 24) return 'Between 0.25 and 24 hours'
  if (Math.abs(value * 4 - Math.round(value * 4)) > 1e-9) return 'Use quarter hours: .25, .5 or .75'
  return null
}

/** Details are required, at least 10 characters trimmed, only for Other. */
export const detailsProblem = (reason, text) =>
  reason === 'other' && String(text ?? '').trim().length < DETAILS_MIN ? 'Say what happened (at least 10 characters)' : null

/** The work note (proof of work) needs at least 10 characters trimmed. */
export const noteProblem = (text) => (String(text ?? '').trim().length < NOTE_MIN ? 'At least 10 characters' : null)
