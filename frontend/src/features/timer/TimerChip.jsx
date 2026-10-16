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
 * When the server stopped a timer left past midnight, says so once; when the clock reaches a limit (8h today, the
 * milestone's estimate, 40h this week), a toast says so once per timer and limit, and the chip turns to a warning. */
export default function TimerChip() {
  const { timer, elapsed, stopped, reached, level } = useTimer()
  const desktop = useMediaQuery(DESKTOP_QUERY)
  const toast = useToast()
  const [stopping, setStopping] = useState(false)
  const told = useRef(null)
  const warned = useRef(new Set())
  useEffect(() => {
    if (stopped && told.current !== stopped.timer.id) {
      told.current = stopped.timer.id
      announceStop(toast, stopped)
    }
  }, [stopped, toast])
  useEffect(() => {
    for (const limit of reached) {
      const key = `${timer?.id}:${limit.kind}`
      if (!warned.current.has(key)) {
        warned.current.add(key)
        toast.warning(limit.message)
      }
    }
  }, [reached, timer, toast])
  if (!timer) return null
  const clock = formatElapsed(elapsed)
  const warn = level !== 'ok'
  // Phones: the clock alone, never squeezed. Desktop: the milestone name gives way first (an ellipsis).
  return (
    <>
      <Tooltip title={`Timer on ${timer.milestone.name} (${timer.project.name})${warn ? ` — ${reached[0]?.message}` : ''}. Click to stop it.`}>
        <Chip icon={<Timer />} color={warn ? 'warning' : 'error'} variant={warn ? 'filled' : 'outlined'} clickable
          onClick={() => setStopping(true)}
          aria-label={`Timer running on ${timer.milestone.name}: ${clock}${warn ? ', limit reached' : ''}. Stop timer`}
          label={desktop ? `${clock} · ${timer.milestone.name}` : clock}
          sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, maxWidth: { xs: 120, md: 280 }, flexShrink: { xs: 0, md: 1 },
            minWidth: { md: 96 } }} />
      </Tooltip>
      {stopping ? <StopTimerDialog timer={timer} elapsed={elapsed} onClose={() => setStopping(false)} /> : null}
    </>
  )
}
