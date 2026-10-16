// Words and styles shared by the Month calendar's pieces.
import { alpha } from '@mui/material/styles'
import { STATUS, statusColor } from '../../app/theme.js'
import { formatDate } from '../../lib/format.js'

/** The milestone's state, as the timeline reads it. */
export const stateKey = (m) => [m.display_status, m.status].find((s) => STATUS[s]) ?? 'not_started'
/** "2026-10-14" → "Oct 14" */
export const shortDate = (iso) => formatDate(iso).replace(/, \d{4}$/, '')
export const isOverdue = (m, today) => stateKey(m) !== 'completed' && m.end_date < today
export const num = (x) => Number(x) || 0
export const hoursWords = (hours) => `${num(hours).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${num(hours) === 1 ? 'hour' : 'hours'}`
export const moreWords = (n) => `${n} more milestone${n === 1 ? '' : 's'} this week`
export const LINE_WORD = { approved: 'approved', pending: 'pending', rejected: 'rejected', draft: 'from timer' }

/** A bar's accessible name: "Build, Oct 13 to Oct 16, In progress", plus ", overdue". */
export const barName = (m, today) => [m.name, `${shortDate(m.start_date)} to ${shortDate(m.end_date)}`,
  STATUS[stateKey(m)].label, isOverdue(m, today) ? 'overdue' : ''].filter(Boolean).join(', ')

export const milestoneHref = (m) => `/projects/${m.project.id}?tab=milestones&milestone=${m.id}`

/** An hours line: approved solid, pending outlined, rejected red and struck through, timer draft dashed. */
export function lineSx(kind, theme) {
  const color = statusColor({ approved: STATUS.approved, pending: STATUS.pending, rejected: STATUS.rejected, draft: STATUS.planned }[kind], theme)
  return { border: 1, borderStyle: kind === 'draft' ? 'dashed' : 'solid', borderColor: color, borderRadius: 0.5, px: 0.5,
    bgcolor: kind === 'approved' ? alpha(color, 0.22) : 'transparent', color: kind === 'rejected' ? color : 'text.primary',
    textDecoration: kind === 'rejected' ? 'line-through' : 'none' }
}
