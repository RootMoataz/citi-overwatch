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

// Lay milestones out as bars across one week. Input order is kept; each
// milestone takes the first lane where it does not overlap, else it is hidden.
export function weekBars(week, milestones, maxLanes = 3) {
  const first = week[0]
  const last = week[6]
  const lanes = []
  const hidden = []
  for (const milestone of milestones) {
    const { start_date: s, end_date: e } = milestone
    if (e < first || s > last) continue
    const startsBefore = s < first
    const endsAfter = e > last
    const startCol = startsBefore ? 0 : week.indexOf(s)
    const endCol = endsAfter ? 6 : week.indexOf(e)
    const bar = { milestone, startCol, endCol, startsBefore, endsAfter, endsHere: !endsAfter }
    const lane = lanes.find((bars) => bars.every((b) => endCol < b.startCol || startCol > b.endCol))
    if (lane) lane.push(bar)
    else if (lanes.length < maxLanes) lanes.push([bar])
    else hidden.push(milestone)
  }
  return { lanes, hidden }
}

// Per day: the hour lines and the counted total. Only pending and approved
// hours count. Lines follow the milestones' list order (the bars'), a milestone
// unknown to the list after those; a milestone's saved hours come before its
// timer draft.
export function dayLines(entries = [], drafts = [], milestones = []) {
  const listed = new Map(milestones.map((m, i) => [m.id, i]))
  const days = new Map()
  const add = (date, line) => {
    if (!days.has(date)) days.set(date, { total: 0, lines: [] })
    const day = days.get(date)
    day.lines.push(line)
    if (line.kind === 'approved' || line.kind === 'pending') day.total += Number(line.hours)
  }
  for (const e of entries) add(e.work_date, { milestone_id: e.milestone_id, hours: Number(e.hours), kind: e.status })
  for (const d of drafts) add(d.work_date, { milestone_id: d.milestone_id, hours: Number(d.hours), kind: 'draft' })
  for (const day of days.values()) {
    const order = new Map()
    day.lines.forEach((l) => order.has(l.milestone_id) || order.set(l.milestone_id, listed.get(l.milestone_id) ?? listed.size + order.size))
    day.lines.sort((a, b) => order.get(a.milestone_id) - order.get(b.milestone_id) || (a.kind === 'draft') - (b.kind === 'draft'))
  }
  return days
}
