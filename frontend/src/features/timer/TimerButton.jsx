import PlayArrow from '@mui/icons-material/PlayArrowRounded'
import Stop from '@mui/icons-material/StopRounded'
import { Box, Button, Tooltip } from '@mui/material'
import { useState } from 'react'
import { useStartTimer } from '../../api/queries.js'
import { useToast } from '../../app/toast.js'
import { useSession } from '../../auth/sessionContext.js'
import { DEMO_DISABLED, demoBlocks } from '../../lib/permissions.js'
import StopTimerDialog from './StopTimerDialog.jsx'
import { formatElapsed } from './timerClock.js'
import { useTimer } from './useTimer.js'

/** Start a timer on this milestone ("Start timer"), or stop the one running on it (with its live clock).
 * Completed milestones get no Start. While a timer runs on another milestone this one can't start: one timer at a time.
 * `touch` makes it a 44 px target everywhere (My week's rows and Now card); elsewhere it is one on phones only. */
export default function TimerButton({ milestone, size = 'small', touch = false }) {
  const { user } = useSession()
  const { enabled, timer, elapsed } = useTimer()
  const start = useStartTimer()
  const toast = useToast()
  const [stopping, setStopping] = useState(false)
  if (!enabled) return null
  const target = { minHeight: touch ? 44 : { xs: 44, md: 'auto' } }
  const mine = timer && String(timer.milestone.id) === String(milestone.id)
  if (mine) {
    return (
      <>
        <Button size={size} variant="contained" color="error" startIcon={<Stop />} onClick={() => setStopping(true)}
          aria-label={`Stop timer on ${milestone.name} (running ${formatElapsed(elapsed)})`}
          sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', minWidth: 104, ...target }}>
          {formatElapsed(elapsed)}
        </Button>
        {stopping ? <StopTimerDialog timer={timer} elapsed={elapsed} onClose={() => setStopping(false)} /> : null}
      </>
    )
  }
  if (milestone.status === 'completed') return null // finished work: no new clock (the server refuses it too)
  const blocked = demoBlocks(user, 'timer.use')
  const busy = Boolean(timer)
  const why = blocked ? DEMO_DISABLED : busy ? `Stop your timer on ${timer.milestone.name} first` : `Start a timer on ${milestone.name}`
  const go = async () => {
    try { await start.mutateAsync(milestone.id) } catch (err) { toast.error(err.message) }
  }
  return (
    <Tooltip title={why}>
      <Box component="span" sx={{ display: 'inline-flex' }}>
        <Button size={size} variant="outlined" startIcon={<PlayArrow />} onClick={go}
          disabled={blocked || busy || start.isPending} aria-label={`Start timer on ${milestone.name}`}
          sx={{ whiteSpace: 'nowrap', ...target }}>
          Start timer
        </Button>
      </Box>
    </Tooltip>
  )
}
