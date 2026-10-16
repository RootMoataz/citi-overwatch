import CheckCircle from '@mui/icons-material/CheckCircleOutlined'
import ErrorIcon from '@mui/icons-material/ErrorOutlineOutlined'
import HourglassEmpty from '@mui/icons-material/HourglassEmpty'
import PlayCircle from '@mui/icons-material/PlayCircleOutlined'
import RadioButtonUnchecked from '@mui/icons-material/RadioButtonUnchecked'
import RateReview from '@mui/icons-material/RateReviewOutlined'
import { Box, Chip, Paper, Stack, Tooltip, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useState } from 'react'
import { chartPalette } from '../app/chartColors.js'
import { STATUS, statusColor } from '../app/theme.js'
import { formatDate, formatHours, todayIso } from '../lib/format.js'
import { PRIORITY } from '../lib/labels.js'
import { STRIPED, stripes } from './stateStripes.js'
import StatusChip from './StatusChip.jsx'

const DAY = 86400000
// A name column beside the chart; under `sm` the name sits above its bar. The detailed layout adds a Dependency column.
const COLUMNS = { xs: 'minmax(0, 1fr)', sm: '200px minmax(0, 1fr)' }
const DETAILED_COLUMNS = { xs: 'minmax(0, 1fr)', sm: 'minmax(0, 290px) 150px minmax(0, 1fr)' }
const spacer = <Box sx={{ display: { xs: 'none', sm: 'block' } }} />
const toTime = (iso) => Date.UTC(...String(iso).slice(0, 10).split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n))))
const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi)
/** "2026-08-15" → "Aug 15" */
const shortDate = (iso) => formatDate(iso).replace(/, \d{4}$/, '')
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const stateKey = (item) => [item.display_status, item.status].find((s) => STATUS[s]) ?? 'not_started'
// The compact layout names the state under each milestone, with an icon so colour is never the only signal.
const STATE_ICON = { completed: CheckCircle, in_progress: PlayCircle, ready_for_review: RateReview, waiting: HourglassEmpty,
  blocked: ErrorIcon, not_started: RadioButtonUnchecked }
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
    marks.push({ pct: ((t - start) / span) * 100, january: d.getUTCMonth() === 0, label: d.getUTCMonth() === 0 ? `${name} ${d.getUTCFullYear()}` : name })
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

function StateWord({ view }) {
  const Icon = STATE_ICON[view.key] ?? RadioButtonUnchecked
  return (
    <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5, color: 'text.secondary' }}>
      <Icon aria-hidden sx={{ fontSize: 14 }} />
      <Typography variant="caption" component="span">{view.meta.label}</Typography>
    </Stack>
  )
}

function TimelineRow({ view, months, todayPct, onOpen, layout }) {
  const { item, meta, key, percent, overdue, after, from, width, placement, text, label, number } = view
  const compact = layout === 'compact'
  const detailed = layout === 'detailed'
  const filled = key === 'in_progress' && percent != null
  const clickable = Boolean(onOpen)
  // Beside the bar on `sm` and up; under it on a phone, or when the bar leaves no room on either side.
  // On `sm` and up it sits on a paper-coloured halo, so the Today line and month lines never cross the text.
  const labelSx = placement === 'below' ? { mt: 0.25 } : {
    mt: { xs: 0.25, sm: 0 }, position: { xs: 'static', sm: 'absolute' }, top: { sm: '50%' }, transform: { sm: 'translateY(-50%)' },
    ...(placement === 'left'
      ? { right: { sm: `calc(${100 - from}% + 8px)` }, maxWidth: { sm: `calc(${from}% - 8px)` }, justifyContent: { sm: 'flex-end' } }
      : { left: { sm: `calc(${from + width}% + 8px)` }, maxWidth: { sm: `calc(${100 - from - width}% - 8px)` } }),
  }
  return (
    <Tooltip describeChild disableInteractive placement="bottom-start" title={<RowTip view={view} />}>
      <Box component="li" tabIndex={0} aria-label={label} data-milestone-id={item.id}
        onClick={clickable ? () => onOpen(item) : undefined}
        onKeyDown={clickable ? (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault() // Space must not scroll the page
            onOpen(item)
          }
        } : undefined}
        sx={{ display: 'grid', gridTemplateColumns: detailed ? DETAILED_COLUMNS : COLUMNS, columnGap: 2, px: 1, borderRadius: 1,
          cursor: clickable ? 'pointer' : 'default',
          '&:nth-of-type(even)': { bgcolor: 'action.hover' }, '&:hover': { bgcolor: 'action.selected' } }}>
        <Box aria-hidden sx={{ minWidth: 0, alignSelf: 'center', pt: 0.75, pb: { xs: 0, sm: 0.75 } }}>
          <Stack direction="row" useFlexGap sx={{ gap: 0.75, alignItems: 'center', flexWrap: 'wrap' }}>
            {detailed ? (
              <Typography variant="body2" component="span" sx={{ color: 'text.secondary', minWidth: 20 }}>{number}</Typography>
            ) : null}
            <Typography variant="body2" component="span" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{item.name}</Typography>
            {item.is_assignee ? (
              <Chip size="small" variant="outlined" color="primary" label="You" sx={{ height: 18, fontSize: '0.6875rem' }} />
            ) : null}
            {detailed ? <Box sx={{ ml: 'auto' }}><StatusChip status={key} icon /></Box> : null}
          </Stack>
          {compact ? <StateWord view={view} /> : null}
          {layout === 'default' && after.length ? (
            <Typography variant="caption" component="div" sx={{ color: 'text.secondary' }}>{`after ${after.join(', ')}`}</Typography>
          ) : null}
        </Box>
        {detailed ? (
          <Typography aria-hidden variant="body2" component="div" sx={{ color: 'text.secondary', alignSelf: 'center', py: 0.75,
            overflowWrap: 'anywhere' }}>
            {after.length ? `After ${after.join(', ')}` : 'None'}
          </Typography>
        ) : null}
        <Box aria-hidden sx={{ position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'center',
          minHeight: 40, pt: { xs: 0.5, sm: 0.75 }, pb: 0.75 }}>
          {/* The lines: the whole cell on `sm` and up; on a phone only the bar strip, since the label sits under it. */}
          <Box sx={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: { sm: 0 }, height: { xs: 26, sm: 'auto' }, pointerEvents: 'none' }}>
            {months.map((m) => (
              <Box key={m.pct} sx={{ position: 'absolute', top: 0, bottom: 0, left: `${m.pct}%`, width: '1px', bgcolor: 'divider' }} />
            ))}
            {todayPct != null ? (
              <Box sx={{ position: 'absolute', top: 0, bottom: 0, left: `${todayPct}%`, width: 0, borderLeft: 2, borderLeftStyle: 'dashed',
                borderColor: (t) => chartPalette(t).reference }} />
            ) : null}
          </Box>
          <Box sx={{ position: 'relative', height: 16 }}>
            <Box className="bar" sx={{ position: 'absolute', left: `${from}%`, width: `${width}%`, top: 0, bottom: 0, boxSizing: 'border-box',
              borderRadius: 8, overflow: 'hidden', border: 1, borderColor: (t) => statusColor(meta, t),
              bgcolor: (t) => (filled ? alpha(statusColor(meta, t), 0.28) : statusColor(meta, t)),
              backgroundImage: STRIPED.has(key) ? stripes(6) : 'none' }}>
              {filled ? <Box sx={{ width: `${percent}%`, height: '100%', bgcolor: (t) => statusColor(meta, t) }} /> : null}
            </Box>
          </Box>
          <Typography variant="caption" component="div"
            sx={{ color: 'text.primary', display: { sm: 'flex' }, alignItems: 'baseline', whiteSpace: { xs: 'normal', sm: 'nowrap' },
              position: 'relative', zIndex: 1, bgcolor: { sm: 'background.paper' }, borderRadius: 0.5, px: { sm: 0.5 }, ...labelSx }}>
            {/* The overdue mark is its own element, so ellipsis can cut the dates but never the mark. */}
            <Box component="span" sx={{ minWidth: 0, overflow: { sm: 'hidden' }, textOverflow: { sm: 'ellipsis' } }}>{text}</Box>
            {overdue ? <Box component="span" sx={{ flexShrink: 0, ml: 0.75, color: 'error.main', fontWeight: 600 }}>⚠ Overdue</Box> : null}
          </Typography>
        </Box>
      </Box>
    </Tooltip>
  )
}

/** A Gantt-style chart of the milestones: a month axis, a bar per milestone with its dates and state beside it,
 * a progress fill, a "today" line and the dependency chain. `layout="compact"` (the Overview) puts the state word
 * and icon under each name and drops the legend and the "after …" line. `layout="detailed"` (the Milestones tab on wide
 * screens) numbers each row, puts its state chip beside the name and the dependencies in a column of their own.
 * `all` (default `items`) is the whole list in dependency order: it numbers the rows and names the dependencies when
 * `items` is a filtered part of it. Clicking a row (or Enter) calls `onOpen(milestone)`. */
export default function Timeline({ items, range, onOpen, layout = 'default', all }) {
  const compact = layout === 'compact'
  const detailed = layout === 'detailed'
  const columns = detailed ? DETAILED_COLUMNS : COLUMNS
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
  const pool = all ?? items
  const byId = Object.fromEntries(pool.map((i) => [String(i.id), i]))
  const numberOf = Object.fromEntries(pool.map((i, n) => [String(i.id), n + 1]))

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
      waiting: waitingOn.length ? `Waiting on ${waitingOn[0]}${waitingOn.length > 1 ? ` +${waitingOn.length - 1}` : ''}` : 'Waiting',
      blocked: 'Blocked',
    }[key] ?? 'Not started'
    const label = [item.name, `${formatDate(item.start_date)} to ${formatDate(item.end_date)}`, meta.label,
      key !== 'completed' && percent != null ? `${percent}% done` : '', overdue ? 'overdue' : '',
      key === 'waiting' && waitingOn.length ? `waiting on ${waitingOn.join(', ')}` : '',
      PRIORITY[item.priority] ? `${PRIORITY[item.priority]} priority` : '', item.is_assignee ? 'yours' : ''].filter(Boolean).join(', ')
    return { item, key, meta, percent, overdue, after: before.map((p) => p.name), waitingOn, from, width, placement,
      text: `${shortDate(item.start_date)} – ${shortDate(item.end_date)}${compact || detailed ? '' : ` · ${state}`}`, label,
      number: numberOf[String(item.id)] }
  })
  // The key lists only the statuses on this timeline, in the order they first appear.
  const shown = [...new Set(views.map((v) => v.key))]
  const mine = items.some((i) => i.is_assignee)

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Box aria-hidden sx={{ display: 'grid', gridTemplateColumns: columns, columnGap: 2, px: 1, mb: 0.5 }}>
        {detailed ? (
          <>
            <Typography variant="caption" sx={{ display: { xs: 'none', sm: 'block' }, alignSelf: 'end', fontWeight: 600, pl: '28px' }}>
              Milestone
            </Typography>
            <Typography variant="caption" sx={{ display: { xs: 'none', sm: 'block' }, alignSelf: 'end', fontWeight: 600 }}>Dependency</Typography>
          </>
        ) : spacer}
        <Box>
          <Stack direction="row" sx={{ justifyContent: 'space-between', mb: 0.5 }}>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>{formatDate(range.start)}</Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>{formatDate(range.end)}</Typography>
          </Stack>
          <Box sx={{ position: 'relative', height: 20 }}>
            {months.map((m, i) => (i % labelEvery === 0 || m.january ? (
              <Typography key={m.pct} variant="caption" sx={{ position: 'absolute', top: 0, bottom: 0, left: `${m.pct}%`, pl: 0.5,
                borderLeft: 1, borderColor: 'divider', color: 'text.secondary', whiteSpace: 'nowrap' }}>{m.label}</Typography>
            ) : null))}
          </Box>
        </Box>
      </Box>
      <Box component="ul" aria-label="Milestone timeline" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {views.map((view) => <TimelineRow key={view.item.id} view={view} months={months} todayPct={todayPct} onOpen={onOpen} layout={layout} />)}
      </Box>
      {todayPct != null ? (
        <Box aria-hidden sx={{ display: 'grid', gridTemplateColumns: columns, columnGap: 2, px: 1, mt: 0.5 }}>
          {spacer}
          {detailed ? spacer : null}
          <Box sx={{ position: 'relative', height: 18 }}>
            <Typography variant="caption" sx={{ position: 'absolute', top: 0, left: `${clamp(todayPct, 3, 97)}%`, transform: 'translateX(-50%)',
              color: 'text.secondary', fontWeight: 600 }}>Today</Typography>
          </Box>
        </Box>
      ) : null}
      {shown.length && !compact ? (
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
