// The planning board's data: which card sits in which column, in what order, and what's wrong with a card.
// Pure functions over milestone payloads; the board components and their tests share them.
import { formatDate } from '../../lib/format.js'

/** Planning columns, left to right. The order is the plan's direction: ideas → ready to plan → scheduled. */
export const COLUMNS = [
  { id: 'backlog', label: 'Backlog', hint: 'Ideas and work not yet thought through' },
  { id: 'ready', label: 'Ready', hint: 'Shaped and ready to put on the schedule' },
  { id: 'scheduled', label: 'Scheduled', hint: 'In the plan, in the order the work happens' },
]
export const COLUMN_LABEL = Object.fromEntries(COLUMNS.map((c) => [c.id, c.label]))
const columnOf = (m) => (COLUMN_LABEL[m.plan_column] ? m.plan_column : 'scheduled')

/** {backlog: [ids], ready: [ids], scheduled: [ids]}, each in sequence order (then end date, then name). */
export function buildColumns(milestones) {
  const out = Object.fromEntries(COLUMNS.map((c) => [c.id, []]))
  const sorted = [...milestones].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0)
    || String(a.end_date).localeCompare(String(b.end_date)) || a.name.localeCompare(b.name))
  for (const m of sorted) out[columnOf(m)].push(String(m.id))
  return out
}

/** A copy of `columns` with card `id` moved to `to` at `index` (the end when left out). */
export function moveCard(columns, id, to, index) {
  const next = Object.fromEntries(Object.entries(columns).map(([k, ids]) => [k, ids.filter((x) => x !== id)]))
  const target = next[to]
  const at = index === undefined ? target.length : Math.max(0, Math.min(index, target.length))
  target.splice(at, 0, id)
  return next
}

/** The body of PUT /projects/{id}/plan/order: every card with its column and place (from 1). */
export function toOrderItems(columns) {
  return COLUMNS.flatMap((c) => columns[c.id].map((id, i) => ({ milestone_id: id, plan_column: c.id, sequence: i + 1 })))
}

/** Milestones with the places from `items` written onto them (for the optimistic update). */
export function applyOrder(milestones, items) {
  const place = new Map(items.map((i) => [String(i.milestone_id), i]))
  return milestones.map((m) => {
    const p = place.get(String(m.id))
    return p ? { ...m, plan_column: p.plan_column, sequence: p.sequence } : m
  })
}

/** Skill names from whatever shape the milestone carries (strings, {name} or {skill: {name}}); none when absent. */
export const skillNames = (m) => (Array.isArray(m.required_skills) ? m.required_skills : [])
  .map((s) => (typeof s === 'string' ? s : s?.name ?? s?.skill?.name)).filter(Boolean)

/** What would stop this card passing the finalize checks, in words. Same rules as the server (rules/planning.py),
 * so problems show on the card before anyone presses Finalize. */
export function cardWarnings(m, { project, columns, names }) {
  const out = []
  if (!m.assignees?.length) out.push('Nobody assigned yet')
  if (m.start_date < project.start_date || m.end_date > project.predicted_end_date) {
    out.push(`Dates fall outside the project (${formatDate(project.start_date)} – ${formatDate(project.predicted_end_date)})`)
  }
  if (columnOf(m) === 'scheduled') {
    const position = columns.scheduled.indexOf(String(m.id))
    for (const pred of (m.predecessors ?? []).map(String)) {
      const name = names[pred] ?? 'another milestone'
      const at = columns.scheduled.indexOf(pred)
      if (at === -1) out.push(`Depends on ${name}, which is not scheduled yet`)
      else if (at > position) out.push(`Scheduled before ${name}, which it depends on`)
    }
  }
  return out
}
