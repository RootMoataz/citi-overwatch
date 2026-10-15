// Pure helpers for the milestone workflow (work log, completion criteria, kickbacks). Unit tested.
import { KICKBACK_REASON } from './labels.js'

/** A percent field: '' is "not given", anything else must be a whole number from 0 to 100. */
export function parsePercent(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return { value: null }
  if (!/^\d{1,3}$/.test(text) || Number(text) > 100) return { error: 'A whole number from 0 to 100' }
  return { value: Number(text) }
}

/** Completion criteria are stored one item per line; blank lines don't count. */
export const criteriaLines = (text) => String(text ?? '').split('\n').map((l) => l.trim()).filter(Boolean)

/** What's wrong with a kickback reason, or null. */
export function kickbackReasonError(reason) {
  const text = String(reason ?? '').trim()
  if (text.length < KICKBACK_REASON.min) return `Explain in at least ${KICKBACK_REASON.min} characters`
  if (text.length > KICKBACK_REASON.max) return `Keep it under ${KICKBACK_REASON.max} characters`
  return null
}

/** The toast after a status change: support routing, auto-assignments after a completion, or plain. */
export function statusToast(data) {
  if (data?.routed_to) {
    return `Status updated. You're now supporting ${data.routed_to.milestone.name} (${data.routed_to.project.name})`
  }
  const assigned = data?.auto_assigned ?? []
  if (assigned.length) {
    const who = assigned.map((a) => `${a.user.name} to ${a.milestone.name}`).join(', ')
    return `Completed. Auto-assigned ${who}`
  }
  const unfilled = data?.unfilled ?? []
  if (unfilled.length) return `Completed. Nobody qualified was free for ${unfilled.map((u) => u.milestone.name).join(', ')}`
  return 'Status updated'
}
