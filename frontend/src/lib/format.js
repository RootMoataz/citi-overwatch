// Display helpers shared by every screen.

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const moneyExact = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

export const formatMoney = (value, { exact = false } = {}) =>
  (exact ? moneyExact : money).format(Number(value ?? 0))

export const formatHours = (value) => `${Number(value ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}h`

export const formatPct = (value) => `${Number(value ?? 0).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`

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
