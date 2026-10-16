import { Box, IconButton, Link, Popover, Skeleton, Stack, Typography, Button, useMediaQuery } from '@mui/material'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import { useMemo, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { useCalendarMonth } from '../../api/queries.js'
import { STATUS, statusColor } from '../../app/theme.js'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import { STRIPED, stripes } from '../../components/stateStripes.js'
import { formatHours, todayIso } from '../../lib/format.js'
import MonthBars from './MonthBars.jsx'
import { DayBox, DayPanel } from './MonthDayBox.jsx'
import { barName, lineSx, milestoneHref, num, shortDate, stateKey } from './monthText.js'
import { dayLines, gridWeeks, monthOf, shiftMonth, weekBars } from './monthLayout.js'

// `xs`: under 600px. A plain query, not theme.breakpoints.down('sm'), whose fractional width the test stub can't read.
const PHONE = '(max-width: 599px)'
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const monthName = (month, withYear) => new Date(`${month}-01T00:00:00Z`)
  .toLocaleDateString('en-US', { month: 'long', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' })
const grid = { width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse' }
const dayCell = { p: 0, border: 1, borderColor: 'divider', verticalAlign: 'top' }

function Swatch({ sx }) {
  return <Box aria-hidden sx={[{ width: 16, height: 10, borderRadius: 0.5, boxSizing: 'border-box' }, sx]} />
}

function Legend() {
  const items = [
    ['Approved', (t) => lineSx('approved', t)], ['Pending', (t) => lineSx('pending', t)], ['Rejected', (t) => lineSx('rejected', t)],
    ['From timer', (t) => lineSx('draft', t)],
    ['Due', { bgcolor: (t) => statusColor(STATUS.in_progress, t), width: 10, height: 10, borderRadius: '50%' }],
    ['Overdue', { bgcolor: (t) => statusColor(STATUS.rejected, t), backgroundImage: stripes(3) }],
  ]
  return (
    <Stack component="ul" direction="row" useFlexGap aria-label="Legend" sx={{ listStyle: 'none', p: 0, m: 0, mt: 2, gap: 2, flexWrap: 'wrap' }}>
      {items.map(([label, sx]) => (
        <Stack component="li" key={label} direction="row" sx={{ alignItems: 'center', gap: 0.75 }}>
          <Swatch sx={sx} />
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>{label}</Typography>
        </Stack>
      ))}
    </Stack>
  )
}

const BAR_STATES = [['Not started', 'not_started'], ['In progress', 'in_progress'], ['Ready for review', 'ready_for_review'],
  ['Completed', 'completed'], ['Waiting (striped)', 'waiting'], ['Blocked (striped)', 'blocked']]

function StateKey() {
  return (
    <Stack component="ul" direction="row" useFlexGap aria-label="Milestone states" sx={{ listStyle: 'none', p: 0, m: 0, mt: 1, gap: 2, flexWrap: 'wrap' }}>
      {BAR_STATES.map(([label, key]) => (
        <Stack component="li" key={key} direction="row" sx={{ alignItems: 'center', gap: 0.75 }}>
          <Swatch sx={{ borderRadius: 5, bgcolor: (t) => statusColor(STATUS[key], t), backgroundImage: STRIPED.has(key) ? stripes(3) : 'none' }} />
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>{label}</Typography>
        </Stack>
      ))}
    </Stack>
  )
}

function SkeletonGrid() {
  return (
    <Box role="status" aria-label="Loading the calendar" sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 0.5 }}>
      {Array.from({ length: 35 }, (_, i) => <Skeleton key={i} variant="rounded" sx={{ height: { xs: 56, sm: 104 } }} />)}
    </Box>
  )
}

function MorePopover({ more, today, onClose }) {
  return (
    <Popover open={Boolean(more)} anchorEl={more?.anchor} onClose={onClose} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
      <Box component="ul" aria-label="More milestones this week" sx={{ listStyle: 'none', m: 0, p: 1.5, display: 'grid', gap: 1, maxWidth: 320 }}>
        {(more?.items ?? []).map((m) => (
          <li key={m.id}>
            <Link component={RouterLink} to={milestoneHref(m)} aria-label={barName(m, today)} underline="hover" color="inherit" onClick={onClose}>
              <Typography component="span" variant="subtitle2" sx={{ display: 'block' }}>{m.name}</Typography>
              <Typography component="span" variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
                {`${shortDate(m.start_date)} – ${shortDate(m.end_date)} · ${STATUS[stateKey(m)].label}`}
              </Typography>
            </Link>
          </li>
        ))}
      </Box>
    </Popover>
  )
}

/** The view-only Month calendar: milestone bars across each week, and each day's hours by milestone and status.
 * `onOpenDay(iso)` is called for a clicked day (on a phone, from the day panel's "Open this day"). */
export default function MonthView({ month, onMonthChange, onOpenDay }) {
  const phone = useMediaQuery(PHONE)
  const [today] = useState(() => todayIso()) // read the clock once, not on every render
  const [pick, setPick] = useState(null)
  const [more, setMore] = useState(null)
  const { data, error, refetch } = useCalendarMonth(month)

  const view = useMemo(() => {
    if (!data) return null
    const lines = dayLines(data.entries, data.drafts)
    // Saved hours first, timer drafts after them (a stable sort keeps dayLines' order within each group).
    for (const day of lines.values()) day.lines.sort((a, b) => (a.kind === 'draft') - (b.kind === 'draft'))
    const overtime = new Set(data.entries.filter((e) => e.over_40 && e.status !== 'rejected').map((e) => e.work_date))
    const due = new Map()
    for (const m of data.milestones) due.set(m.end_date, [...(due.get(m.end_date) ?? []), m])
    const names = new Map(data.milestones.map((m) => [m.id, m]))
    const total = [...lines].reduce((sum, [date, info]) => sum + (monthOf(date) === month ? num(info.total) : 0), 0)
    return { lines, overtime, due, names, total, weeks: gridWeeks(data.range), empty: !data.milestones.length && !lines.size }
  }, [data, month])

  const selected = pick?.month === month ? pick.date : (monthOf(today) === month ? today : `${month}-01`)
  const open = (date) => (phone ? setPick({ month, date }) : onOpenDay(date))

  return (
    <Box>
      <Stack direction="row" useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1, mb: 2 }}>
        <IconButton aria-label="Previous month" onClick={() => onMonthChange(shiftMonth(month, -1))}><ChevronLeftIcon /></IconButton>
        <IconButton aria-label="Next month" onClick={() => onMonthChange(shiftMonth(month, 1))}><ChevronRightIcon /></IconButton>
        <Button size="small" variant="outlined" onClick={() => onMonthChange(monthOf(today))}>This month</Button>
        <Typography variant="h5" component="h2" sx={{ mr: 'auto' }}>{monthName(month, true)}</Typography>
        {view ? <Typography variant="body2" sx={{ color: 'text.secondary' }}>{`${formatHours(view.total)} logged in ${monthName(month)}`}</Typography> : null}
      </Stack>
      {error ? <ErrorAlert error={error} title="Couldn't load the calendar" onRetry={refetch} /> : null}
      {!view && !error ? <SkeletonGrid /> : null}
      {view ? (
        <>
          {view.empty ? <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>Nothing assigned to you this month</Typography> : null}
          <Box component="table" aria-label={monthName(month, true)} sx={grid}>
            <Box component="thead">
              <tr>{WEEKDAYS.map((d) => <Box component="th" key={d} scope="col" sx={{ p: 0.5, typography: 'caption', color: 'text.secondary' }}>{d}</Box>)}</tr>
            </Box>
            {view.weeks.map((week) => {
              const { lanes, hidden } = weekBars(week, data.milestones)
              return (
                <Box component="tbody" key={week[0]}>
                  {phone ? null : <MonthBars lanes={lanes} hidden={hidden} today={today} onMore={(anchor, items) => setMore({ anchor, items })} />}
                  <tr>
                    {week.map((date, i) => (
                      <Box component="td" key={date} sx={dayCell}>
                        <DayBox date={date} info={view.lines.get(date)} names={view.names} due={view.due.get(date) ?? []}
                          overtime={view.overtime.has(date)} inMonth={monthOf(date) === month} weekend={i >= 5} past={date < today}
                          isToday={date === today} phone={phone} selected={phone && date === selected} onPick={open} />
                      </Box>
                    ))}
                  </tr>
                </Box>
              )
            })}
          </Box>
          {phone ? <DayPanel date={selected} info={view.lines.get(selected)} names={view.names} today={today}
            milestones={data.milestones} onOpen={() => onOpenDay(selected)} /> : null}
          <Legend />
          <StateKey />
          <MorePopover more={more} today={today} onClose={() => setMore(null)} />
        </>
      ) : null}
    </Box>
  )
}
