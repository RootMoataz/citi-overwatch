import ChevronLeft from '@mui/icons-material/ChevronLeft'
import ChevronRight from '@mui/icons-material/ChevronRight'
import {
  Alert, AlertTitle, Box, Button, FormControlLabel, IconButton, Skeleton, Stack, Switch, Typography,
} from '@mui/material'
import { useState } from 'react'
import { useMediaQuery } from 'react-responsive'
import { useSearchParams } from 'react-router-dom'
import TimerLimitBanner from '../timer/TimerLimitBanner.jsx'
import { NOTE_MAX, NOTE_MIN } from '../timer/timerClock.js'
import { RequestChangeDialog } from './LockedCell.jsx'
import WeekGrid from './WeekGrid.jsx'
import { DAY_CAP, MIN_HOURS, key, useTimesheetWeek } from './useTimesheetWeek.js'
import EmptyState from '../../components/EmptyState.jsx'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import PageHeader from '../../components/PageHeader.jsx'
import { addDays, formatDate, formatDayLabel, formatHours, mondayOf } from '../../lib/format.js'
import { DESKTOP_QUERY } from '../../lib/responsive.js'

const CAP = 40

export default function TimesheetPage() {
  const desktop = useMediaQuery(DESKTOP_QUERY)
  const [params, setParams] = useSearchParams()
  const week = params.get('week') ?? mondayOf(new Date())
  const [showWeekend, setShowWeekend] = useState(false)
  const [asking, setAsking] = useState(null)
  const state = useTimesheetWeek(week)
  const { sheet, rows, allDays, total, overDays, tooMany, tooFew, changed, failure, saving, onSave, dayTotal, nameOf } = state

  const days = desktop || showWeekend ? allDays : allDays.slice(0, 5)
  const waitingDraft = Number(sheet.data?.totals?.draft ?? 0)

  const goTo = (target) => { state.discard(); setParams({ week: target }, { replace: true }) }

  const thisWeek = week === mondayOf(new Date())

  return (
    <>
      <PageHeader title="My timesheet" subtitle="Log hours per day on the milestones you're assigned to. Every entry goes to the project manager for approval."
        actions={<Button variant="contained" onClick={onSave} disabled={!changed.length || tooMany || tooFew || saving}>
          {saving ? 'Saving…' : 'Save week'}</Button>} />
      <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 1, alignItems: { sm: 'center' }, mb: 2 }}>
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
          <IconButton aria-label="Previous week" onClick={() => goTo(addDays(week, -7))}><ChevronLeft /></IconButton>
          <Typography variant="subtitle1" component="p">Week of {formatDate(week)}</Typography>
          <IconButton aria-label="Next week" onClick={() => goTo(addDays(week, 7))}><ChevronRight /></IconButton>
          <Button size="small" onClick={() => goTo(mondayOf(new Date()))}>This week</Button>
        </Stack>
        <Box sx={{ flexGrow: 1 }} />
        <Typography data-testid="week-total" data-over={total > CAP} variant="h3" component="p"
          sx={{ color: total > CAP ? 'warning.main' : 'text.primary' }}>
          {formatHours(total)} / {CAP}h
        </Typography>
        {!desktop ? <FormControlLabel control={<Switch checked={showWeekend} onChange={(e) => setShowWeekend(e.target.checked)} />} label="Weekend" /> : null}
      </Stack>
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
          </Box>
        </Alert>
      ))}
      {tooMany && !overDays.length ? <Alert severity="error" sx={{ mb: 2 }}>A cell can't hold more than {DAY_CAP} hours.</Alert> : null}
      {tooFew ? <Alert severity="error" sx={{ mb: 2 }}>Log at least {MIN_HOURS} hours, or leave the cell empty.</Alert> : null}
      {failure?.code === 'TIMER_HOURS_LOCKED' ? null : failure?.code === 'PROOF_REQUIRED' ? (
        <Alert severity="error" role="alert" sx={{ mb: 2 }}>
          <AlertTitle>Add a work note before saving</AlertTitle>
          Each new or changed day needs a note ({NOTE_MIN}-{NOTE_MAX} characters) or a progress update you posted on that
          milestone that day. Missing for:
          <Box component="ul" sx={{ my: 0.5, pl: 3 }}>
            {(failure.details?.cells ?? []).map((c) => (
              <li key={key(c.milestone_id, c.work_date)}>
                {nameOf(c.milestone_id)}, {formatDayLabel(c.work_date)}{c.reason === 'note_too_short' ? ' (note too short)' : ''}
              </li>
            ))}
          </Box>
          Use the highlighted note icon under each of those cells.
        </Alert>
      ) : (
        <ErrorAlert error={failure ?? sheet.error} title={failure ? "Couldn't save your week" : undefined}
          onRetry={failure ? undefined : () => sheet.refetch()} sx={{ mb: 2 }} />
      )}
      <TimerLimitBanner />
      {waitingDraft > 0 ? (
        <Alert severity="info" sx={{ mb: 2 }} data-testid="timer-draft-banner">
          You have {formatHours(waitingDraft)} of timer time not submitted yet — Save week to submit.
          {' '}Cells with a timer mark are pre-filled from your timer and locked; use Request a change to fix their hours.
        </Alert>
      ) : null}
      {failure?.code === 'TIMER_HOURS_LOCKED' ? (
        <Alert severity="error" role="alert" sx={{ mb: 2 }}>
          <AlertTitle>Timer hours can&apos;t be edited</AlertTitle>
          {(failure.details?.cells ?? []).map((c) => `${nameOf(c.milestone_id)}, ${formatDayLabel(c.work_date)}`).join('; ')}
          {' '}— use Request a change on those cells instead.
        </Alert>
      ) : null}
      {sheet.isLoading ? <Skeleton variant="rounded" height={240} /> : null}
      {!sheet.isLoading && !sheet.error && rows.length === 0 ? (
        <EmptyState title="You're not assigned to any milestones this week"
          description="Your project manager assigns you to milestones; they'll show up here as rows." />
      ) : null}
      {rows.length ? <WeekGrid state={state} days={days} thisWeek={thisWeek} onRequest={(cell) => setAsking(cell)} /> : null}
      {asking ? <RequestChangeDialog cell={asking} onClose={() => setAsking(null)} /> : null}
    </>
  )
}
