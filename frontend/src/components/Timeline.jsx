import { Box, Chip, Paper, Stack, Tooltip, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useState } from 'react'
import { chartPalette } from '../app/chartColors.js'
import { STATUS, statusColor } from '../app/theme.js'
import { formatDate, formatHours, todayIso } from '../lib/format.js'
import { PRIORITY } from '../lib/labels.js'

const DAY = 86400000
// Striped bars: waiting on a predecessor, or kicked back and waiting for the manager.
const STRIPED = new Set(['waiting', 'blocked'])
// A name column beside the chart; under `sm` the name sits above its bar.
const COLUMNS = { xs: 'minmax(0, 1fr)', sm: '200px minmax(0, 1fr)' }
const stripes = (size) => `repeating-linear-gradient(45deg, rgba(255,255,255,.35) 0 ${size}px, transparent ${size}px ${size * 2}px)`
const toTime = (iso) => Date.UTC(...String(iso).slice(0, 10).split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n))))
const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi)
/** "2026-08-15" → "Aug 15" */
const shortDate = (iso) => formatDate(iso).replace(/, \d{4}$/, '')
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const stateKey = (item) => [item.display_status, item.status].find((s) => STATUS[s]) ?? 'not_started'
const percentOf = (item) => {
  const n = item.progress_percent == null ? NaN : Number(item.progress_percent)
  return Number.isFinite(n) ? clamp(n, 0, 100) : null
}

/** The first of every month inside the range, as a share of its width. January carries its year. */
function monthMarks(start, span) {
  const first = new Date(start)
  let year = first.getUTCFullYear()
  let month = first.getUTCMonth()
  if (Date.UTC(year, month, 1) < start) month += 1
  const marks = []
  for (let t = Date.UTC(year, month, 1); t < start + span; t = Date.UTC(year, ++month, 1)) {
    const d = new Date(t)
    const name = d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
    marks.push({ pct: ((t - start) / span) * 100, label: d.getUTCMonth() === 0 ? `${name} ${d.getUTCFullYear()}` : name })
  }
  return marks
}

function RowTip({ view }) {
  const { item, meta, key, percent, overdue, after, waitingOn } = view
  const logged = Number(item.logged_hours) || 0
  const hours = item.estimated_hours != null
    ? `${formatHours(logged)} logged of ${formatHours(item.estimated_hours)} estimated`
    : (logged ? `${formatHours(logged)} logged` : '')
  const state = [key === 'waiting' && waitingOn.length ? `Waiting on ${waitingOn.join(', ')}` : meta.label,
    key !== 'completed' && percent != null ? `${percent}% done` : '', overdue ? '⚠ Overdue' : ''].filter(Boolean).join(' · ')
  const people = item.assignees?.length ? `People: ${item.assignees.map((a) => a.name).join(', ')}` : 'Nobody assigned'
  return (
    <Stack sx={{ gap: 0.25 }}>
      <Typography variant="subtitle2" component="div">{item.name}</Typography>
      <Typography variant="caption" component="div">
        {`${formatDate(item.start_date)} – ${formatDate(item.end_date)}`
          + (item.working_days != null ? ` · ${plural(item.working_days, 'working day')}` : '')}
      </Typography>
      <Typography variant="caption" component="div">{state}</Typography>
      {after.length ? <Typography variant="caption" component="div">{`Runs after ${after.join(', ')}`}</Typography> : null}
      <Typography variant="caption" component="div">{people}</Typography>
      {hours ? <Typography variant="caption" component="div">{hours}</Typography> : null}
    </Stack>
  )
}

function TimelineRow({ view, months, todayPct, onOpen }) {
  const { item, meta, key, percent, overdue, after, from, width, placement, text, label } = view
  const filled = key === 'in_progress' && percent != null
  const clickable = Boolean(onOpen)
  // Beside the bar on `sm` and up; under it on a phone, or when the bar leaves no room on either side.
  const labelSx = placement === 'below' ? { mt: 0.25 } : {
    mt: { xs: 0.25, sm: 0 }, position: { xs: 'static', sm: 'absolute' }, top: { sm: '50%' }, transform: { sm: 'translateY(-50%)' },
    ...(placement === 'left'
      ? { left: { sm: 0 }, right: { sm: `calc(${100 - from}% + 8px)` }, textAlign: { sm: 'right' } }
      : { left: { sm: `calc(${from + width}% + 8px)` }, right: { sm: 0 } }),
  }
  return (
    <Tooltip describeChild placement="bottom-start" title={<RowTip view={view} />}>
      <Box component="li" tabIndex={0} aria-label={label}
        onClick={clickable ? () => onOpen(item) : undefined}
        onKeyDown={clickable ? (e) => { if (e.key === 'Enter') onOpen(item) } : undefined}
        sx={{ display: 'grid', gridTemplateColumns: COLUMNS, columnGap: 2, px: 1, borderRadius: 1, cursor: clickable ? 'pointer' : 'default',
          '&:nth-of-type(even)': { bgcolor: 'action.hover' }, '&:hover': { bgcolor: 'action.selected' } }}>
        <Box aria-hidden sx={{ minWidth: 0, alignSelf: 'center', pt: 0.75, pb: { xs: 0, sm: 0.75 } }}>
          <Stack direction="row" useFlexGap sx={{ gap: 0.75, alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography variant="body2" component="span" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{item.name}</Typography>
            {item.is_assignee ? (
              <Chip size="small" variant="outlined" color="primary" label="You" sx={{ height: 18, fontSize: '0.6875rem' }} />
            ) : null}
          </Stack>
          {after.length ? (
            <Typography variant="caption" component="div" sx={{ color: 'text.secondary' }}>{`after ${after.join(', ')}`}</Typography>
          ) : null}
        </Box>
        <Box aria-hidden sx={{ position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'center',
          minHeight: 40, pt: { xs: 0.5, sm: 0.75 }, pb: 0.75 }}>
          {months.map((m) => (
            <Box key={m.pct} sx={{ position: 'absolute', top: 0, bottom: 0, left: `${m.pct}%`, width: '1px', bgcolor: 'divider' }} />
          ))}
          <Box sx={{ position: 'relative', height: 16 }}>
            <Box className="bar" sx={{ position: 'absolute', left: `${from}%`, width: `${width}%`, top: 0, bottom: 0, boxSizing: 'border-box',
              borderRadius: 8, overflow: 'hidden', border: 1, borderColor: (t) => statusColor(meta, t),
              bgcolor: (t) => (filled ? alpha(statusColor(meta, t), 0.28) : statusColor(meta, t)),
              backgroundImage: STRIPED.has(key) ? stripes(6) : 'none' }}>
              {filled ? <Box sx={{ width: `${percent}%`, height: '100%', bgcolor: (t) => statusColor(meta, t) }} /> : null}
            </Box>
          </Box>
          {todayPct != null ? (
            <Box sx={{ position: 'absolute', top: 0, bottom: 0, left: `${todayPct}%`, width: 0, borderLeft: 2, borderLeftStyle: 'dashed',
              borderColor: (t) => chartPalette(t).reference }} />
          ) : null}
          <Typography variant="caption" component="div" noWrap sx={{ color: 'text.primary', ...labelSx }}>
            {text}
            {overdue ? <>{' · '}<Box component="span" sx={{ color: 'error.main', fontWeight: 600 }}>⚠ Overdue</Box></> : null}
          </Typography>
        </Box>
      </Box>
    </Tooltip>
  )
}

/** A Gantt-style chart of the milestones: a month axis, a bar per milestone with its dates and state beside it,
 * a progress fill, a "today" line and the dependency chain. Clicking a row (or Enter) calls `onOpen(milestone)`. */
export default function Timeline({ items, range, onOpen }) {
  const start = toTime(range.start)
  const end = toTime(range.end ?? range.start)
  const span = Number.isFinite(end) ? Math.max(end - start + DAY, DAY) : DAY
  const pct = (time) => {
    const share = ((time - start) / span) * 100
    return Number.isFinite(share) ? clamp(share, 0, 100) : 0
  }
  const [today] = useState(() => todayIso()) // read the clock once, not on every render
  const todayShare = ((toTime(today) + DAY / 2 - start) / span) * 100
  const todayPct = todayShare >= 0 && todayShare <= 100 ? todayShare : null
  const months = monthMarks(start, span)
  const labelEvery = Math.ceil(months.length / 12) // a long project skips labels rather than overprinting them
  const byId = Object.fromEntries(items.map((i) => [String(i.id), i]))

  const views = items.map((item) => {
    const key = stateKey(item)
    const meta = STATUS[key]
    const percent = percentOf(item)
    const overdue = key !== 'completed' && String(item.end_date).slice(0, 10) < today
    const before = (item.predecessors ?? []).map((id) => byId[String(id)]).filter(Boolean)
    const open = before.filter((p) => stateKey(p) !== 'completed')
    const waitingOn = (open.length ? open : before).map((p) => p.name)
    const from = Math.min(pct(toTime(item.start_date)), 99)
    const width = Math.min(Math.max(pct(toTime(item.end_date) + DAY) - from, 1.5), 100 - from)
    // The label goes right of the bar, or left of it when the bar runs to the far end, or under it when neither side has room.
    const placement = from + width <= 70 ? 'right' : (from >= 30 ? 'left' : 'below')
    const state = {
      completed: 'Done',
      in_progress: percent == null ? 'In progress' : `${percent}% done`,
      ready_for_review: 'Ready for review',
      waiting: waitingOn.length ? `Waiting on ${waitingOn.join(', ')}` : 'Waiting',
      blocked: 'Blocked',
    }[key] ?? 'Not started'
    const label = [item.name, `${formatDate(item.start_date)} to ${formatDate(item.end_date)}`, meta.label,
      key !== 'completed' && percent != null ? `${percent}% done` : '', overdue ? 'overdue' : '',
      PRIORITY[item.priority] ? `${PRIORITY[item.priority]} priority` : ''].filter(Boolean).join(', ')
    return { item, key, meta, percent, overdue, after: before.map((p) => p.name), waitingOn, from, width, placement,
      text: `${shortDate(item.start_date)} – ${shortDate(item.end_date)} · ${state}`, label }
  })
  // The key lists only the statuses on this timeline, in the order they first appear.
  const shown = [...new Set(views.map((v) => v.key))]
  const mine = items.some((i) => i.is_assignee)

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Box aria-hidden sx={{ display: 'grid', gridTemplateColumns: COLUMNS, columnGap: 2, px: 1, mb: 0.5 }}>
        <Box sx={{ display: { xs: 'none', sm: 'block' } }} />
        <Box>
          <Stack direction="row" sx={{ justifyContent: 'space-between', mb: 0.5 }}>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>{formatDate(range.start)}</Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>{formatDate(range.end)}</Typography>
          </Stack>
          <Box sx={{ position: 'relative', height: 20 }}>
            {months.map((m, i) => (i % labelEvery === 0 ? (
              <Typography key={m.pct} variant="caption" sx={{ position: 'absolute', top: 0, bottom: 0, left: `${m.pct}%`, pl: 0.5,
                borderLeft: 1, borderColor: 'divider', color: 'text.secondary', whiteSpace: 'nowrap' }}>{m.label}</Typography>
            ) : null))}
          </Box>
        </Box>
      </Box>
      <Box component="ul" aria-label="Milestone timeline" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {views.map((view) => <TimelineRow key={view.item.id} view={view} months={months} todayPct={todayPct} onOpen={onOpen} />)}
      </Box>
      {todayPct != null ? (
        <Box aria-hidden sx={{ display: 'grid', gridTemplateColumns: COLUMNS, columnGap: 2, px: 1, mt: 0.5 }}>
          <Box sx={{ display: { xs: 'none', sm: 'block' } }} />
          <Box sx={{ position: 'relative', height: 18 }}>
            <Typography variant="caption" sx={{ position: 'absolute', top: 0, left: `${clamp(todayPct, 3, 97)}%`, transform: 'translateX(-50%)',
              color: 'text.secondary', fontWeight: 600 }}>Today</Typography>
          </Box>
        </Box>
      ) : null}
      {shown.length ? (
        <Stack component="ul" direction="row" useFlexGap aria-label="Status colours"
          sx={{ listStyle: 'none', p: 0, m: 0, mt: 2, gap: 2, flexWrap: 'wrap' }}>
          {shown.map((status) => (
            <Stack component="li" key={status} direction="row" sx={{ alignItems: 'center', gap: 0.75 }}>
              <Box aria-hidden sx={{ width: 16, height: 8, borderRadius: 4, bgcolor: (t) => statusColor(STATUS[status], t),
                backgroundImage: STRIPED.has(status) ? stripes(3) : 'none' }} />
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>{STATUS[status].label}</Typography>
            </Stack>
          ))}
          {todayPct != null ? <Stack component="li" direction="row" sx={{ alignItems: 'center', gap: 0.75 }}>
            <Box aria-hidden sx={{ height: 12, borderLeft: 2, borderLeftStyle: 'dashed', borderColor: (t) => chartPalette(t).reference }} />
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>Today</Typography>
          </Stack> : null}
          {mine ? <Stack component="li" direction="row" sx={{ alignItems: 'center', gap: 0.75 }}>
            <Box aria-hidden sx={{ width: 22, height: 14, borderRadius: 7, border: 1, borderColor: 'primary.main' }} />
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>Your milestone</Typography>
          </Stack> : null}
        </Stack>
      ) : null}
    </Paper>
  )
}
