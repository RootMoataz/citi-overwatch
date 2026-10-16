// Words and colours shared by the Month calendar's pieces. Colours mean approval status only.
import CheckCircle from '@mui/icons-material/CheckCircle'
import ErrorIcon from '@mui/icons-material/Error'
import Schedule from '@mui/icons-material/ScheduleOutlined'
import TimerOutlined from '@mui/icons-material/TimerOutlined'
import { alpha, darken } from '@mui/material/styles'
import { STATUS, statusColor } from '../../app/theme.js'
import { formatDate, formatHours } from '../../lib/format.js'

/** The milestone's state, as the timeline reads it. */
export const stateKey = (m) => [m.display_status, m.status].find((s) => STATUS[s]) ?? 'not_started'
/** "2026-10-14" → "Oct 14" */
export const shortDate = (iso) => formatDate(iso).replace(/, \d{4}$/, '')
export const isOverdue = (m, today) => stateKey(m) !== 'completed' && m.end_date < today
export const num = (x) => Number(x) || 0
export const hoursWords = (hours) => `${num(hours).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${num(hours) === 1 ? 'hour' : 'hours'}`
export const milestoneHref = (m) => `/projects/${m.project.id}?tab=milestones&milestone=${m.id}`

/** A line's status: the grid chip's word (none for approved), the panel chip's word, and the word in a day's accessible name. */
export const KIND = {
  approved: { chip: null, panel: 'Approved', legend: 'Approved', spoken: 'approved', status: STATUS.approved },
  pending: { chip: 'Pending', panel: 'Pending approval', legend: 'Pending', spoken: 'pending', status: STATUS.pending },
  rejected: { chip: 'Needs revision', panel: 'Needs revision', legend: 'Needs revision', spoken: 'needs revision', status: STATUS.rejected },
  draft: { chip: 'Not submitted', panel: 'Not submitted', legend: 'Not submitted', spoken: 'not submitted', status: STATUS.planned },
}
export const KINDS = ['approved', 'pending', 'rejected', 'draft']
/** Every status has an icon as well as a colour: ✓, a clock, !, a timer. */
export const KIND_ICON = { approved: CheckCircle, pending: Schedule, rejected: ErrorIcon, draft: TimerOutlined }

/** The status colour (dots, icons, chip edges) and a darker shade for small status words on a light page. */
export const kindColor = (kind, theme) => statusColor(KIND[kind].status, theme)
export const kindText = (kind, theme) => (theme.palette.mode === 'dark' ? kindColor(kind, theme) : darken(kindColor(kind, theme), 0.2))

/** A chip in a status's colours: a light fill and edge; a timer draft is neutral with a dashed edge. */
export const chipSx = (kind) => (theme) => {
  const color = kindColor(kind, theme)
  return { border: 1, borderStyle: kind === 'draft' ? 'dashed' : 'solid', borderColor: alpha(color, kind === 'draft' ? 0.7 : 0.35),
    bgcolor: kind === 'draft' ? 'transparent' : alpha(color, theme.palette.mode === 'dark' ? 0.16 : 0.08), borderRadius: 1 }
}

export const deadlineWords = (n) => `${n} milestone deadline${n === 1 ? '' : 's'}`

const SOURCES = { tracked: 'Tracked', manual: 'Manual', mixed: 'Mixed' }

/** The API's `source` when the entry has one; else Manual when no hours came from a timer, Tracked when all of them did,
 * Mixed otherwise. A timer draft is all timer. */
export function sourceOf(line) {
  if (line.kind === 'draft') return 'Tracked'
  const given = SOURCES[line.entry?.source]
  if (given) return given
  const tracked = num(line.entry?.tracked_hours)
  if (tracked <= 0) return 'Manual'
  return tracked >= num(line.hours) ? 'Tracked' : 'Mixed'
}

/** "4h pending", "8h · 6h approved, 2h pending", or "No hours". */
export function daySummary(lines, total) {
  if (!lines.length) return 'No hours'
  const parts = KINDS.map((kind) => [kind, lines.filter((l) => l.kind === kind).reduce((s, l) => s + num(l.hours), 0)])
    .filter(([, hours]) => hours > 0)
  const words = parts.map(([kind, hours]) => `${formatHours(hours)} ${KIND[kind].spoken}`)
  if (parts.length === 1 && (parts[0][0] === 'approved' || parts[0][0] === 'pending')) return words[0]
  return `${formatHours(total)} · ${words.join(', ')}`
}
