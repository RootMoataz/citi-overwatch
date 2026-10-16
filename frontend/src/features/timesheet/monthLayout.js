// Pure layout helpers for the Month calendar. All date maths runs on ISO
// strings in UTC, so a daylight-saving change never repeats or skips a day.

const DAY_MS = 86400000

const toUtc = (iso) => {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}
const fromUtc = (ms) => new Date(ms).toISOString().slice(0, 10)

// One array of 7 ISO dates per week, Monday first, covering range.start..range.end.
export function gridWeeks({ start, end }) {
  const weeks = []
  const last = toUtc(end)
  for (let ms = toUtc(start); ms <= last; ms += 7 * DAY_MS) {
    weeks.push(Array.from({ length: 7 }, (_, i) => fromUtc(ms + i * DAY_MS)))
  }
  return weeks
}

export const monthOf = (iso) => iso.slice(0, 7)

export function shiftMonth(month, n) {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7)
}

// Per day: the hour lines and the counted total. Only pending and approved
// hours count. Lines follow the milestones' list order, a milestone unknown to
// the list after those; a milestone's saved hours come before its timer draft.
// A saved line keeps its entry (tracked hours, rejection reason) for the day panel.
export function dayLines(entries = [], drafts = [], milestones = []) {
  const listed = new Map(milestones.map((m, i) => [m.id, i]))
  const days = new Map()
  const add = (date, line) => {
    if (!days.has(date)) days.set(date, { total: 0, lines: [] })
    const day = days.get(date)
    day.lines.push(line)
    if (line.kind === 'approved' || line.kind === 'pending') day.total += Number(line.hours)
  }
  for (const e of entries) add(e.work_date, { milestone_id: e.milestone_id, hours: Number(e.hours), kind: e.status, entry: e })
  for (const d of drafts) add(d.work_date, { milestone_id: d.milestone_id, hours: Number(d.hours), kind: 'draft' })
  for (const day of days.values()) {
    const order = new Map()
    day.lines.forEach((l) => order.has(l.milestone_id) || order.set(l.milestone_id, listed.get(l.milestone_id) ?? listed.size + order.size))
    day.lines.sort((a, b) => order.get(a.milestone_id) - order.get(b.milestone_id) || (a.kind === 'draft') - (b.kind === 'draft'))
  }
  return days
}
