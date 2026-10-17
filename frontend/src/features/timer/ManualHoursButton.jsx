import { Box, Button, Tooltip } from '@mui/material'
import { useState } from 'react'
import { useSession } from '../../auth/sessionContext.js'
import { DEMO_DISABLED, can, demoBlocks } from '../../lib/permissions.js'
import ManualHoursDialog from './ManualHoursDialog.jsx'
import { useTimer } from './useTimer.js'

/** "Log hours manually" on a milestone: opens the pop-up on `day` (today when none). Hidden for anyone who keeps no
 * timesheet, on a completed milestone and while this milestone's own timer runs (stop it first). A timer running on
 * another milestone doesn't matter. Same 44 px target rule as TimerButton: `touch` always, else below `md`. */
export default function ManualHoursButton({ milestone, project, day, size = 'small', touch = false }) {
  const { user } = useSession()
  const { timer } = useTimer()
  const [open, setOpen] = useState(false)
  if (!can(user, 'hours.manual')) return null
  if (milestone.status === 'completed') return null
  if (timer && String(timer.milestone.id) === String(milestone.id)) return null
  const blocked = demoBlocks(user, 'hours.manual')
  return (
    <>
      <Tooltip title={blocked ? DEMO_DISABLED : `Log hours on ${milestone.name} without the timer`}>
        <Box component="span" sx={{ display: 'inline-flex' }}>
          <Button size={size} variant="outlined" onClick={() => setOpen(true)} disabled={blocked}
            aria-label={`Log hours manually on ${milestone.name}`}
            sx={{ whiteSpace: 'nowrap', minHeight: touch ? 44 : { xs: 44, md: 'auto' } }}>
            Log hours manually
          </Button>
        </Box>
      </Tooltip>
      {open ? <ManualHoursDialog milestone={milestone} project={project} day={day} onClose={() => setOpen(false)} /> : null}
    </>
  )
}
