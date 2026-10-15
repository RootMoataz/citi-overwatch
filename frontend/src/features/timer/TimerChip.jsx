import Timer from '@mui/icons-material/TimerOutlined'
import { Chip, Tooltip } from '@mui/material'
import { useEffect, useRef, useState } from 'react'
import { useToast } from '../../app/toast.js'
import { useMediaQuery } from 'react-responsive'
import { DESKTOP_QUERY } from '../../lib/responsive.js'
import StopTimerDialog from './StopTimerDialog.jsx'
import { announceStop, formatElapsed } from './timerClock.js'
import { useTimer } from './useTimer.js'

/** The running timer in the header, on every page and across reloads (GET /timers/current); click to stop it.
 * When the server stopped a timer left past midnight, says so once. */
export default function TimerChip() {
  const { timer, elapsed, stopped } = useTimer()
  const desktop = useMediaQuery(DESKTOP_QUERY)
  const toast = useToast()
  const [stopping, setStopping] = useState(false)
  const told = useRef(null)
  useEffect(() => {
    if (stopped && told.current !== stopped.timer.id) {
      told.current = stopped.timer.id
      announceStop(toast, stopped)
    }
  }, [stopped, toast])
  if (!timer) return null
  const clock = formatElapsed(elapsed)
  return (
    <>
      <Tooltip title={`Timer on ${timer.milestone.name} (${timer.project.name}). Click to stop it.`}>
        <Chip icon={<Timer />} color="error" variant="outlined" clickable onClick={() => setStopping(true)}
          aria-label={`Timer running on ${timer.milestone.name}: ${clock}. Stop timer`}
          label={desktop ? `${clock} · ${timer.milestone.name}` : clock}
          sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, maxWidth: { xs: 120, md: 280 } }} />
      </Tooltip>
      {stopping ? <StopTimerDialog timer={timer} elapsed={elapsed} onClose={() => setStopping(false)} /> : null}
    </>
  )
}
