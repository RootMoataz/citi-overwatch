import ChevronLeft from '@mui/icons-material/ChevronLeft'
import ChevronRight from '@mui/icons-material/ChevronRight'
import {
  Alert, AlertTitle, Box, Button, FormControlLabel, IconButton, Link, Paper, Skeleton, Stack, Switch, ToggleButton,
  ToggleButtonGroup, Typography,
} from '@mui/material'
import { Fragment, useEffect, useState } from 'react'
import { useMediaQuery } from 'react-responsive'
import { Link as RouterLink, useSearchParams } from 'react-router-dom'
import TimerLimitBanner from '../timer/TimerLimitBanner.jsx'
import { NOTE_MAX, NOTE_MIN } from '../timer/timerClock.js'
import DayView from './DayView.jsx'
import { RequestChangeDialog } from './LockedCell.jsx'
import MonthView from './MonthView.jsx'
import { monthOf } from './monthLayout.js'
import WeekGrid from './WeekGrid.jsx'
import WeekStrip from './WeekStrip.jsx'
import WeekTotals from './WeekTotals.jsx'
import { weekFigures } from './weekFigures.js'
import { DAY_CAP, MIN_HOURS, key, useTimesheetWeek } from './useTimesheetWeek.js'
import ConfirmDialog from '../../components/ConfirmDialog.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import FootNote from '../../components/FootNote.jsx'
import PageHeader from '../../components/PageHeader.jsx'
import { addDays, formatDayLabel, formatDayShort, formatHours, formatWeekRange, mondayOf, nyMondayIso, nyTodayIso } from '../../lib/format.js'
import { DESKTOP_QUERY } from '../../lib/responsive.js'

const CAP = 40
const VIEW_KEY = 'overwatch.timesheet.view'

// The Day, Week or Month choice is kept per browser; blocked storage just means Day every time.
const readView = () => {
  try {
    const v = window.localStorage.getItem(VIEW_KEY)
    return v === 'week' || v === 'month' ? v : 'day'
  } catch { return 'day' }
}
// Monday of the week holding an ISO day, by local calendar parts so a daylight-saving change can't shift it.
const mondayOfIso = (iso) => {
  const [y, m, d] = iso.split('-').map(Number)
  return mondayOf(new Date(y, m - 1, d))
}
// The view a page opens in: ?month= means Month; a link to a week or day (no month) is for logging hours, so never Month.
const openingView = (params) => {
  if (params.has('month')) return 'month'
  const stored = readView()
  return stored === 'month' && (params.has('week') || params.has('day')) ? 'day' : stored
}
const storeView = (view) => {
  try { window.localStorage.setItem(VIEW_KEY, view) } catch { /* blocked: the choice lasts until the page closes */ }
}

/** A day named in an error, as a link that opens it in the day view. */
function DayLink({ week, date, children }) {
  return <Link component={RouterLink} to={`?week=${week}&day=${date}`} replace>{children}</Link>
}

export default function TimesheetPage() {
  const desktop = useMediaQuery(DESKTOP_QUERY)
  const [params, setParams] = useSearchParams()
  const week = params.get('week') ?? nyMondayIso()
  const [view, setView] = useState(() => openingView(params))
  const [sheetView, setSheetView] = useState(() => (readView() === 'week' ? 'week' : 'day')) // where "Back to that week" returns
  const [showWeekend, setShowWeekend] = useState(false)
  const [asking, setAsking] = useState(null)
  const [leaving, setLeaving] = useState({ open: false, week: null, day: undefined, count: 0 }) // the "discard your changes?" question
  const state = useTimesheetWeek(week)
  const { sheet, rows, allDays, total, overDays, tooMany, tooFew, tooFewKeys, changed, failure, saving, onSave, dayTotal, nameOf, entries, isDraft } = state

  const days = desktop || showWeekend ? allDays : allDays.slice(0, 5)
  const waitingDraft = Number(sheet.data?.totals?.draft ?? 0)

  const thisWeek = week === nyMondayIso()
  // The open day comes from ?day=; a missing or out-of-week value opens today (this week) or the Monday.
  const asked = params.get('day')
  const day = allDays.includes(asked) ? asked : thisWeek ? nyTodayIso() : week
  const inDayView = view === 'day'
  const inMonth = view === 'month'
  // The month comes from ?month=; without it, from the selected day (today for the current week, else the Monday).
  const askedMonth = params.get('month')
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(askedMonth ?? '') ? askedMonth : monthOf(day)
  const n = changed.length
  const figures = weekFigures({ entries, changed, isDraft, total })

  // Closing or reloading the tab with unsaved changes asks the browser to confirm.
  const dirty = n > 0
  useEffect(() => {
    if (!dirty) return undefined
    const warn = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  // The month is written into the URL as soon as the Month view opens, so a reload or a shared link keeps it. So is the day on
  // show (a past week's Monday, not the 1st), so Month opens on the day you were looking at.
  useEffect(() => {
    if (inMonth && askedMonth !== month) {
      setParams((p) => { const next = new URLSearchParams(p); next.set('month', month); if (!next.has('day')) next.set('day', day); return next }, { replace: true })
    }
  }, [inMonth, askedMonth, month, day, setParams])

  // With a day, the week opens in the Day view on that day (a day picked in the Month view).
  const toWeek = (target, pick) => {
    state.discard()
    if (pick) { chooseView('day'); setParams({ week: target, day: pick }, { replace: true }) } else setParams({ week: target }, { replace: true })
  }
  const goTo = (target, pick) => (n ? setLeaving({ open: true, week: target, day: pick, count: n }) : toWeek(target, pick))
  const openDay = (iso) => {
    const target = mondayOfIso(iso)
    if (target === week) { chooseView('day'); setParams({ week, day: iso }, { replace: true }) } else goTo(target, iso)
  }
  // Already on this week there is nothing to leave: just open today.
  const goThisWeek = () => (thisWeek ? setParams({ week, day: nyTodayIso() }, { replace: true }) : goTo(nyMondayIso()))
  const overDate = failure?.code === 'DAY_OVER_24H' && inDayView && allDays.includes(failure.details?.work_date) ? failure.details.work_date : null
  const stay = () => setLeaving((l) => ({ ...l, open: false }))
  const chooseView = (next) => {
    if (next !== 'month') setSheetView(next)
    setView(next)
    storeView(next)
    // Leaving Month drops ?month=, or a reload would open Month again.
    if (next !== 'month' && params.has('month')) setParams((p) => { const q = new URLSearchParams(p); q.delete('month'); return q }, { replace: true })
  }
  // A cell named in an error; in the day view it links to its day.
  const cellRef = (milestoneId, date) => {
    const text = `${nameOf(milestoneId)}, ${formatDayLabel(date)}`
    return inDayView ? <DayLink week={week} date={date}>{text}</DayLink> : text
  }

  const toggle = (
    <ToggleButtonGroup exclusive size="small" value={view} aria-label="Timesheet view"
      onChange={(_, next) => { if (next) chooseView(next) }}>
      <ToggleButton value="day">Day</ToggleButton>
      <ToggleButton value="week">Week</ToggleButton>
      <ToggleButton value="month">Month</ToggleButton>
    </ToggleButtonGroup>
  )

  // The month calendar never edits; unsaved edits stay in memory (and the leave warning stays on) until you go back to the week.
  // In Month, ?day= is the selected day; a new month drops it, and a day of another month brings its month along.
  const inMonthUrl = (change) => setParams((p) => { const q = new URLSearchParams(p); change(q); return q }, { replace: true })
  if (inMonth) {
    return (
      <>
        <PageHeader title="My timesheet" subtitle="Review your hours by day. Select a date for entry details." actions={toggle} />
        {n ? (
          <Alert severity="info" sx={{ mb: 2 }} action={<Button color="inherit" size="small" onClick={() => chooseView(sheetView)}>Back to that week</Button>}>
            You have {n} unsaved change{n === 1 ? '' : 's'} in the week of {formatDayShort(week)}.
          </Alert>
        ) : null}
        <MonthView month={month} day={asked} onOpenDay={openDay} onRequest={(cell) => setAsking(cell)}
          onSelectDay={(iso) => inMonthUrl((q) => { q.set('month', monthOf(iso)); q.set('day', iso) })}
          onMonthChange={(next) => inMonthUrl((q) => { q.set('month', next); q.delete('day') })} />
        {asking ? <RequestChangeDialog cell={asking} onClose={() => setAsking(null)} /> : null}
        <ConfirmDialog open={leaving.open} title={`Discard ${leaving.count} unsaved change${leaving.count === 1 ? '' : 's'}?`}
          body="The hours and notes you typed haven't been submitted and will be lost." confirmLabel="Discard"
          onConfirm={() => { toWeek(leaving.week, leaving.day); stay() }} onClose={stay} />
      </>
    )
  }

  return (
    <>
      <PageHeader title="My timesheet" subtitle="Review your week. Submit with confidence."
        actions={<Button variant="contained" onClick={onSave} disabled={!n || tooMany || tooFew || saving}>
          {saving ? 'Saving…' : n ? `Submit ${n} change${n === 1 ? '' : 's'}` : 'Submit'}</Button>} />
      <WeekTotals figures={figures} cap={CAP} />
      {total > CAP ? (
        <Alert severity="warning" sx={{ mb: 2 }}>
          This week is {formatHours(total)} — {formatHours(total - CAP)} over {CAP}h. Hours above {CAP} are sent to your manager as an overtime request.
        </Alert>
      ) : null}
      {overDays.map((d) => (
        <Alert key={d} severity="error" sx={{ mb: 1 }}>
          <Box component="span" sx={{ fontWeight: 700 }}>More than {DAY_CAP}h on {formatDayLabel(d)}</Box>
          <Box component="span" sx={{ display: 'block' }}>
            That day adds up to {formatHours(dayTotal(d))} across your milestones. Lower it to save.
            {inDayView && d !== day ? <>{' '}<DayLink week={week} date={d}>Go to {formatDayLabel(d)}</DayLink></> : null}
          </Box>
        </Alert>
      ))}
      {tooMany && !overDays.length ? <Alert severity="error" sx={{ mb: 2 }}>A cell can't hold more than {DAY_CAP} hours.</Alert> : null}
      {tooFew ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          Log at least {MIN_HOURS} hours, or leave the cell empty.
          <Box component="ul" sx={{ my: 0.5, pl: 3 }}>
            {tooFewKeys.map((k) => {
              const [milestoneId, date] = k.split('|')
              return <li key={k}>{cellRef(milestoneId, date)}</li>
            })}
          </Box>
        </Alert>
      ) : null}
      {failure?.code === 'TIMER_HOURS_LOCKED' ? null : failure?.code === 'PROOF_REQUIRED' ? (
        <Alert severity="error" role="alert" sx={{ mb: 2 }}>
          <AlertTitle>Add a work note before saving</AlertTitle>
          Each new or changed day needs a note ({NOTE_MIN}-{NOTE_MAX} characters) or a progress update you posted on that
          milestone that day. Missing for:
          <Box component="ul" sx={{ my: 0.5, pl: 3 }}>
            {(failure.details?.cells ?? []).map((c) => (
              <li key={key(c.milestone_id, c.work_date)}>
                {cellRef(c.milestone_id, c.work_date)}
                {c.reason === 'note_too_short' ? ' (note too short)' : ''}
              </li>
            ))}
          </Box>
          {inDayView ? 'Use the note box on each of those rows.' : 'Use the highlighted note icon under each of those cells.'}
        </Alert>
      ) : (
        <ErrorAlert error={failure ?? sheet.error} title={failure ? "Couldn't save your week" : undefined}
          onRetry={failure ? undefined : () => sheet.refetch()} sx={{ mb: 2 }}>
          {overDate ? <DayLink week={week} date={overDate}>Go to {formatDayLabel(overDate)}</DayLink> : null}
        </ErrorAlert>
      )}
      <TimerLimitBanner />
      {waitingDraft > 0 ? (
        <Alert severity="info" sx={{ mb: 2 }} data-testid="timer-draft-banner">
          You have {formatHours(waitingDraft)} of timer time not submitted yet — press Submit to send it.
          {' '}Cells with a timer mark are pre-filled from your timer and locked; use Request a change to fix their hours.
        </Alert>
      ) : null}
      {failure?.code === 'TIMER_HOURS_LOCKED' ? (
        <Alert severity="error" role="alert" sx={{ mb: 2 }}>
          <AlertTitle>Timer hours can&apos;t be edited</AlertTitle>
          {(failure.details?.cells ?? []).map((c, i) => (
            <Fragment key={key(c.milestone_id, c.work_date)}>{i ? '; ' : ''}{cellRef(c.milestone_id, c.work_date)}</Fragment>
          ))}
          {' '}— use Request a change on those cells instead.
        </Alert>
      ) : null}
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 1, alignItems: { sm: 'center' }, mb: 2 }}>
          <Stack direction="row" sx={{ alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <IconButton aria-label="Previous week" onClick={() => goTo(addDays(week, -7))}><ChevronLeft /></IconButton>
            <Typography variant="h2" component="h2" sx={{ fontSize: '1.125rem' }}>{formatWeekRange(week)}</Typography>
            <IconButton aria-label="Next week" onClick={() => goTo(addDays(week, 7))}><ChevronRight /></IconButton>
            <Button size="small" onClick={goThisWeek}>This week</Button>
          </Stack>
          <Box sx={{ flexGrow: 1 }} />
          {toggle}
          {!desktop && !inDayView ? <FormControlLabel control={<Switch checked={showWeekend} onChange={(e) => setShowWeekend(e.target.checked)} />} label="Weekend" /> : null}
        </Stack>
        {rows.length && inDayView ? (
          <WeekStrip days={allDays} selected={day} dayTotal={dayTotal} overDays={overDays}
            onSelect={(d) => setParams({ week, day: d }, { replace: true })} />
        ) : null}
        {sheet.isLoading ? <Skeleton variant="rounded" height={240} /> : null}
        {!sheet.isLoading && !sheet.error && rows.length === 0 ? (
          <EmptyState title="You're not assigned to any milestones this week"
            description="Your project manager assigns you to milestones; they'll show up here as rows." />
        ) : null}
        {rows.length && inDayView ? <DayView state={state} day={day} thisWeek={thisWeek} onRequest={(cell) => setAsking(cell)} /> : null}
        {rows.length && !inDayView ? <WeekGrid state={state} days={days} thisWeek={thisWeek} onRequest={(cell) => setAsking(cell)} /> : null}
      </Paper>
      {figures.needsRevision > 0 ? (
        <FootNote note={`${formatHours(figures.entered)} entered · ${formatHours(figures.needsRevision)} excluded until resubmitted.`} />
      ) : null}
      {asking ? <RequestChangeDialog cell={asking} onClose={() => setAsking(null)} /> : null}
      <ConfirmDialog open={leaving.open} title={`Discard ${leaving.count} unsaved change${leaving.count === 1 ? '' : 's'}?`}
        body="The hours and notes you typed haven't been submitted and will be lost." confirmLabel="Discard"
        onConfirm={() => { toWeek(leaving.week, leaving.day); stay() }} onClose={stay} />
    </>
  )
}
