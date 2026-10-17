import { Alert, AlertTitle, Button } from '@mui/material'
import { Link as RouterLink } from 'react-router-dom'
import Critical from '../../components/Critical.jsx'
import { formatHours } from '../../lib/format.js'
import { useTimer } from './useTimer.js'

/** The employee's own warnings, from their running timer and their timer hours not submitted yet:
 * - the running timer has reached a limit (8h today, the milestone's estimate, 40h this week): a warning banner, the limit
 *   in bold;
 * - timer hours wait in the timesheet: "You have 2.5h of timer time not submitted yet" with a way there
 *   (`showUnsubmitted`; the timesheet shows its own banner instead). */
export default function TimerLimitBanner({ showUnsubmitted = false, sx }) {
  const { timer, reached, level, unsubmitted } = useTimer()
  const waiting = unsubmitted.reduce((sum, u) => sum + Number(u.hours), 0)
  const oldest = unsubmitted[0]
  return (
    <>
      {timer && reached.length ? (
        <Alert severity={level === 'over' ? 'error' : 'warning'} role="alert" sx={{ mb: 2, ...sx }}>
          <AlertTitle><Critical>{reached[0].message}</Critical></AlertTitle>
          {reached.length > 1 ? `${reached.slice(1).map((l) => l.message).join('. ')}. ` : null}
          Your timer on {timer.milestone.name} is still running — stop it if you&apos;re done, or tell your manager why
          it needs longer.
        </Alert>
      ) : null}
      {showUnsubmitted && waiting > 0 ? (
        <Alert severity="info" sx={{ mb: 2, ...sx }}
          action={<Button component={RouterLink} to={`/timesheet?week=${oldest.week_start}`} color="inherit" size="small">
            Open timesheet</Button>}>
          You have {formatHours(waiting)} of timer time not submitted yet — open your timesheet and press Submit to send it.
        </Alert>
      ) : null}
    </>
  )
}
