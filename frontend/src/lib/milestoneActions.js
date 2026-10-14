/** Status buttons this person may use right now (spec §3.5). */
export function statusActions(m, { manager, assignee }) {
  const out = []
  if (m.status === 'not_started' && (manager || assignee)) out.push({ label: 'Start', target: 'in_progress' })
  if (m.status === 'in_progress' && (manager || assignee)) out.push({ label: 'Ready for review', target: 'ready_for_review' })
  if (manager && ['in_progress', 'ready_for_review'].includes(m.status)) out.push({ label: 'Complete', target: 'completed', primary: true })
  if (manager && m.status === 'ready_for_review') out.push({ label: 'Send back', target: 'in_progress' })
  if (manager && m.status === 'completed') out.push({ label: 'Reopen', target: 'in_progress' })
  return out
}
