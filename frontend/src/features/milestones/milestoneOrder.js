// How milestones and their people are ordered and named across the Milestones tab: the list, the panel and the menu.

/** Part C's state order: the status bar left to right, and the list's Status sort. */
export const STATUS_ORDER = ['completed', 'ready_for_review', 'in_progress', 'not_started', 'waiting', 'blocked']

/** The state a milestone shows: its display status (waiting is computed by the server), else its stored status. */
export const stateOf = (m) => [m.display_status, m.status].find((s) => STATUS_ORDER.includes(s)) ?? 'not_started'

/**
 * The milestone's people, primaries first, then those only supporting: `{ id, name, supporting, detail, highlight }`.
 * `detail` ("Primary" or "Supporting") and `highlight` (a ring on primaries when some people only support) are what
 * AvatarStack shows.
 */
export function assigneePeople(m) {
  const supportingIds = new Set((m.supporting_ids ?? []).map(String))
  const people = (m.assignees ?? []).map((a) => ({ id: a.id, name: a.name, supporting: supportingIds.has(String(a.id)) }))
    .sort((a, b) => a.supporting - b.supporting)
  const mixed = people.some((p) => p.supporting)
  return people.map((p) => ({ ...p, detail: p.supporting ? 'Supporting' : 'Primary', highlight: mixed && !p.supporting }))
}

/** The names of the milestones `m` depends on, looked up in `items` (the whole list). */
export const predecessorNames = (m, items) => (m.predecessors ?? [])
  .map((id) => items.find((x) => String(x.id) === String(id))?.name).filter(Boolean)
