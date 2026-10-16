// Display helpers shared by every screen.

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const moneyExact = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

export const formatMoney = (value, { exact = false } = {}) =>
  (exact ? moneyExact : money).format(Number(value ?? 0))

export const formatHours = (value) => `${Number(value ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}h`

export const formatPct = (value) => `${Number(value ?? 0).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`

/** "1 day", "3 days"; `many` for irregular plurals: plural(2, 'entry', 'entries') → "2 entries". */
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** "2026-10-13" → "Oct 13, 2026" without timezone shifts. */
export function formatDate(iso) {
  if (!iso) return '—'
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US',
    { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

export const fullName = (person) =>
  person ? person.name ?? `${person.first_name ?? ''} ${person.last_name ?? ''}`.trim() : ''

/** Monday (YYYY-MM-DD) of the week containing `date`. */
export function mondayOf(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const shift = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - shift)
  return d.toISOString().slice(0, 10)
}

/** "2026-10-14" → "2026-10-12": the Monday of an ISO day's week, without timezone shifts. */
export function mondayOfIso(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number)
  return mondayOf(new Date(y, m - 1, d))
}

/** Today's date (YYYY-MM-DD) on the viewer's own calendar. */
export function todayIso(date = new Date()) {
  return addDays(mondayOf(date), (date.getDay() + 6) % 7)
}

export function addDays(iso, days) {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return dt.toISOString().slice(0, 10)
}

/** "2026-10-13" → "Tue Oct 13" */
export function formatDayLabel(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  const day = dt.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
  const month = dt.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
  return `${day} ${month} ${d}`
}

const dayPart = (iso, options) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { ...options, timeZone: 'UTC' })
}

/** "2026-10-14" → "Wed 14 Oct" */
export const formatDayShort = (iso) =>
  `${dayPart(iso, { weekday: 'short' })} ${dayPart(iso, { day: 'numeric' })} ${dayPart(iso, { month: 'short' })}`

/** "2026-10-14" → "Wednesday 14 October 2026" */
export const formatDayFull = (iso) => `${dayPart(iso, { weekday: 'long' })} ${dayPart(iso, { day: 'numeric' })} `
  + `${dayPart(iso, { month: 'long' })} ${dayPart(iso, { year: 'numeric' })}`

/** "2026-10-14" → "Wed, Oct 14, 2026" */
export const formatDayLong = (iso) => `${dayPart(iso, { weekday: 'short' })}, ${formatDate(iso)}`

const nyParts = new Intl.DateTimeFormat('en-CA',
  { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })

/** Today's date (YYYY-MM-DD) on the New York calendar, which every project footer and due line uses. */
export function nyTodayIso(now = new Date()) {
  const parts = Object.fromEntries(nyParts.formatToParts(now).map((p) => [p.type, p.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

/** "2026-10-15" → "October 15, 2026" */
export function formatLongDate(iso) {
  if (!iso) return '—'
  return dayPart(String(iso).slice(0, 10), { month: 'long', day: 'numeric', year: 'numeric' })
}

/** Whole days from one date to another (negative when `toIso` is earlier). */
export function daysBetween(fromIso, toIso) {
  const ms = (iso) => {
    const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number)
    return Date.UTC(y, m - 1, d)
  }
  return Math.round((ms(toIso) - ms(fromIso)) / 86400000)
}

/** "Jul 15 – Dec 27, 2026" within a year; "Dec 1, 2025 – Mar 3, 2026" across years. */
export function formatDateRange(startIso, endIso) {
  const sameYear = String(startIso).slice(0, 4) === String(endIso).slice(0, 4)
  const start = sameYear ? dayPart(startIso, { month: 'short', day: 'numeric' }) : formatDate(startIso)
  return `${start} – ${formatDate(endIso)}`
}

/** "2026-10-12" (a Monday) → "Oct 12 – 18, 2026"; "Sep 28 – Oct 4, 2026"; "Dec 28, 2026 – Jan 3, 2027". */
export function formatWeekRange(mondayIso) {
  const end = addDays(mondayIso, 6)
  const [startYear, startMonth] = [mondayIso.slice(0, 4), mondayIso.slice(5, 7)]
  if (startYear !== end.slice(0, 4)) return `${formatDate(mondayIso)} – ${formatDate(end)}`
  if (startMonth === end.slice(5, 7)) {
    return `${dayPart(mondayIso, { month: 'short', day: 'numeric' })} – ${dayPart(end, { day: 'numeric' })}, ${startYear}`
  }
  return formatDateRange(mondayIso, end)
}

/** The Monday (YYYY-MM-DD) of the New York week that `now` falls in. */
export function nyMondayIso(now = new Date()) {
  return mondayOfIso(nyTodayIso(now))
}
