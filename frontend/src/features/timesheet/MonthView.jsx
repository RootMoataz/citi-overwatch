import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import EventOutlined from '@mui/icons-material/EventOutlined'
import { Box, Button, IconButton, Paper, Skeleton, Stack, Typography, useMediaQuery } from '@mui/material'
import { visuallyHidden } from '@mui/utils'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useCalendarMonth } from '../../api/queries.js'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import { addDays, formatHours, todayIso } from '../../lib/format.js'
import { DayBox, StatusShape } from './MonthDayBox.jsx'
import MonthDayPanel from './MonthDayPanel.jsx'
import { KIND, KINDS, KIND_ICON, kindColor, kindText, num, stateKey } from './monthText.js'
import { dayLines, gridWeeks, monthOf, shiftMonth } from './monthLayout.js'

// Plain queries, not theme.breakpoints, whose fractional widths the test stub can't read. `xs` is under 600px; the panel
// moves beside the grid from `md` (900px) up.
const PHONE = '(max-width: 599px)'
const SIDE = '(min-width: 900px)'
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const monthName = (month, withYear) => new Date(`${month}-01T00:00:00Z`)
  .toLocaleDateString('en-US', { month: 'long', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' })
const isRealDay = (iso) => typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso) && addDays(iso, 0) === iso
const KEYBOARD_HINT = 'Arrow keys move between days, Home and End to the start and end of the week, Page Up and Page Down to '
  + 'the previous and next month. Enter or Space selects a day.'

/** `iso`'s day of the month in the month `n` months from `shown`, or that month's last day when it is shorter ("Jan 31"
 * + 1 → "Feb 28"). It counts from the month shown, not from `iso`'s own month: from 28 Sep in the October grid, Page Up
 * is 28 Sep (September), not 28 Aug. */
function sameDayIn(iso, n, shown) {
  const month = shiftMonth(shown, n)
  const [y, m] = month.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${month}-${String(Math.min(Number(iso.slice(8)), last)).padStart(2, '0')}`
}

/** Where a key moves the focus from `iso` in the grid of month `shown` (WAI-ARIA grid keys), or null for any other key.
 * Weeks start on Monday. */
function moveFrom(iso, key, shown) {
  const weekday = (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7
  switch (key) {
    case 'ArrowLeft': return addDays(iso, -1)
    case 'ArrowRight': return addDays(iso, 1)
    case 'ArrowUp': return addDays(iso, -7)
    case 'ArrowDown': return addDays(iso, 7)
    case 'Home': return addDays(iso, -weekday)
    case 'End': return addDays(iso, 6 - weekday)
    case 'PageUp': return sameDayIn(iso, -1, shown)
    case 'PageDown': return sameDayIn(iso, 1, shown)
    default: return null
  }
}

function Legend({ phone }) {
  return (
    <Paper variant="outlined" sx={{ mt: 2, px: 2, py: 1.25 }}>
      <Stack component="ul" direction="row" useFlexGap aria-label="Legend"
        sx={{ listStyle: 'none', p: 0, m: 0, gap: { xs: 1.5, sm: 3 }, flexWrap: 'wrap', alignItems: 'center' }}>
        {KINDS.map((kind) => {
          const Icon = KIND_ICON[kind]
          return (
            <Stack component="li" key={kind} direction="row" sx={{ alignItems: 'center', gap: 0.75 }}>
              {phone ? <StatusShape kind={kind} legend /> : <Icon sx={{ fontSize: 18, color: (t) => kindColor(kind, t) }} />}
              <Typography variant="body2" component="span">{KIND[kind].legend}</Typography>
            </Stack>
          )
        })}
        {phone ? (
          <>
            <Stack component="li" direction="row" sx={{ alignItems: 'center', gap: 0.75 }}>
              <Box component="span" aria-hidden sx={{ color: (t) => kindText('pending', t), fontWeight: 600 }}>⚠</Box>
              <Typography variant="body2" component="span">Over 40h</Typography>
            </Stack>
            <Stack component="li" direction="row" sx={{ alignItems: 'center', gap: 0.75 }}>
              <EventOutlined aria-hidden sx={{ fontSize: 18, color: 'text.secondary' }} />
              <Typography variant="body2" component="span">Milestone deadline</Typography>
            </Stack>
          </>
        ) : null}
        <Box component="li" sx={{ pl: { md: 3 }, borderLeft: { md: 1 }, borderColor: { md: 'divider' } }}>
          <Typography variant="body2" component="span" sx={{ color: 'text.secondary' }}>
            Milestone dates appear separately from time-entry status.
          </Typography>
        </Box>
      </Stack>
    </Paper>
  )
}

function SkeletonGrid() {
  return (
    <Box role="status" aria-label="Loading the calendar" sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 0.5 }}>
      {Array.from({ length: 35 }, (_, i) => <Skeleton key={i} variant="rounded" sx={{ height: { xs: 64, sm: 112 } }} />)}
    </Box>
  )
}

/** The view-only Month calendar, hours first: each day's total and its lines by approval status, deadline markers, and a
 * panel for the selected day. `day` is the selection from the URL; outside the month it falls back to today, else the 1st.
 * onSelectDay(iso) selects a day; onOpenDay(iso) opens it in the Day view; onRequest(cell) asks to change timer hours. */
export default function MonthView({ month, day, onMonthChange, onSelectDay, onOpenDay, onRequest }) {
  const phone = useMediaQuery(PHONE)
  const side = useMediaQuery(SIDE)
  const [today] = useState(() => todayIso()) // read the clock once, not on every render
  const { data, error, refetch } = useCalendarMonth(month)
  const headingRef = useRef(null)
  const hintId = useId()
  // The grid is one tab stop (roving focus): the focused day takes Tab, the others -1. `cells` finds a day's button.
  const cells = useRef(new Map())
  const [focusDay, setFocusDay] = useState(null)
  // What to focus once another month has rendered: a day (a key that leaves the month) or the panel heading (a keyboard
  // selection of a day in another month). Until then the grid is a skeleton and the old focus target is gone.
  const pending = useRef(null)

  const view = useMemo(() => {
    if (!data) return null
    const lines = dayLines(data.entries, data.drafts, data.milestones)
    const overtime = new Set(data.entries.filter((e) => e.over_40 && e.status !== 'rejected').map((e) => e.work_date))
    // Deadlines: milestones the person is assigned to, not completed, ending that day.
    const deadlines = new Map()
    for (const m of data.milestones) {
      if (m.role != null && stateKey(m) !== 'completed') deadlines.set(m.end_date, [...(deadlines.get(m.end_date) ?? []), m])
    }
    const locks = new Map((data.locks ?? []).map((l) => [`${l.milestone_id}|${l.work_date}`, l]))
    const names = new Map(data.milestones.map((m) => [m.id, m]))
    const total = [...lines].reduce((sum, [date, info]) => sum + (monthOf(date) === month ? num(info.total) : 0), 0)
    return { lines, overtime, deadlines, locks, names, total, weeks: gridWeeks(data.range), empty: !data.milestones.length && !lines.size }
  }, [data, month])

  const selected = isRealDay(day) && monthOf(day) === month ? day : monthOf(today) === month ? today : `${month}-01`
  const inGrid = (iso) => Boolean(view?.weeks.some((week) => week.includes(iso)))
  const tabStop = focusDay && inGrid(focusDay) ? focusDay : selected

  useEffect(() => {
    const target = pending.current
    if (!view || !target || monthOf(target.date) !== month) return
    pending.current = null
    if (target.heading) headingRef.current?.focus()
    else cells.current.get(target.date)?.focus()
  }, [view, month])

  const pick = (iso, keyboard) => {
    onSelectDay(iso)
    setFocusDay(iso)
    if (!keyboard) return
    if (monthOf(iso) === month) headingRef.current?.focus()
    else pending.current = { date: iso, heading: true }
  }
  const onGridKey = (from, event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return // browser shortcuts (Alt+Left is Back) stay the browser's
    const to = moveFrom(from, event.key, month)
    if (!to) return
    event.preventDefault()
    setFocusDay(to)
    // Page Up / Page Down always show the target's month; an arrow only when it steps off the grid.
    const page = event.key === 'PageUp' || event.key === 'PageDown'
    if (monthOf(to) !== month && (page || !inGrid(to))) {
      pending.current = { date: to }
      onMonthChange(monthOf(to))
    } else {
      cells.current.get(to)?.focus()
    }
  }

  return (
    <Box>
      <Stack direction="row" useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1, mb: 2 }}>
        <IconButton aria-label="Previous month" onClick={() => onMonthChange(shiftMonth(month, -1))}><ChevronLeftIcon /></IconButton>
        <Button size="small" variant="outlined" onClick={() => onMonthChange(monthOf(today))}>This month</Button>
        <IconButton aria-label="Next month" onClick={() => onMonthChange(shiftMonth(month, 1))}><ChevronRightIcon /></IconButton>
        <Typography variant="h5" component="h2" sx={{ mr: 'auto', ml: 0.5, fontWeight: 700 }}>{monthName(month, true)}</Typography>
        {view ? (
          <Box sx={{ textAlign: { sm: 'right' } }}>
            <Typography variant="subtitle1" component="p" sx={{ fontWeight: 700, lineHeight: 1.3 }}>
              {`${formatHours(view.total)} logged in ${monthName(month)}`}
            </Typography>
            <Typography variant="caption" component="p" sx={{ color: 'text.secondary' }}>Pending + approved · Rejected hours excluded.</Typography>
          </Box>
        ) : null}
      </Stack>
      {error ? <ErrorAlert error={error} title="Couldn't load the calendar" onRetry={refetch} /> : null}
      {!view && !error ? <SkeletonGrid /> : null}
      {view ? (
        <>
          {view.empty ? <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>Nothing assigned to you this month</Typography> : null}
          <Box sx={{ display: 'grid', gap: 2, alignItems: 'start', gridTemplateColumns: side ? 'minmax(0, 1fr) 340px' : 'minmax(0, 1fr)' }}>
            <Paper variant="outlined" sx={{ overflow: 'hidden', minWidth: 0 }}>
              <Box component="span" id={hintId} sx={visuallyHidden}>{KEYBOARD_HINT}</Box>
              <Box component="table" aria-label={monthName(month, true)} aria-describedby={hintId}
                sx={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse' }}>
                <Box component="thead">
                  <tr>
                    {WEEKDAYS.map((d) => (
                      <Box component="th" key={d} scope="col" sx={{ py: 1, px: 0.5, typography: 'body2', fontWeight: 600, color: 'text.secondary' }}>{d}</Box>
                    ))}
                  </tr>
                </Box>
                <tbody>
                  {view.weeks.map((week) => (
                    <tr key={week[0]}>
                      {week.map((date, i) => (
                        <Box component="td" key={date} sx={{ p: 0, height: '1px', verticalAlign: 'top', borderTop: 1, borderLeft: i ? 1 : 0, borderColor: 'divider' }}>
                          <DayBox date={date} info={view.lines.get(date)} names={view.names} deadlines={view.deadlines.get(date)?.length ?? 0}
                            overtime={view.overtime.has(date)} inMonth={monthOf(date) === month} weekend={i >= 5} isToday={date === today}
                            selected={date === selected} phone={phone} tabStop={date === tabStop}
                            buttonRef={(node) => { if (node) cells.current.set(date, node); else cells.current.delete(date) }}
                            onFocus={() => setFocusDay(date)} onKeyDown={(e) => onGridKey(date, e)} onPick={pick} />
                        </Box>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </Box>
            </Paper>
            <MonthDayPanel date={selected} isToday={selected === today} info={view.lines.get(selected)} names={view.names}
              locks={view.locks} overtime={view.overtime.has(selected)} headingRef={headingRef} deadlines={view.deadlines.get(selected) ?? []} today={today} onOpenDay={onOpenDay} onRequest={onRequest} />
          </Box>
          <Legend phone={phone} />
        </>
      ) : null}
    </Box>
  )
}
