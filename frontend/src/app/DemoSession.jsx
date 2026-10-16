// What a public demo admin sees: one countdown pill in the top bar (a button with a popover and a once-only
// screen-reader warning at 1:00), a notice on the pages the demo restricts, and a one-time welcome after sign-in.
// Theme colours come from MUI, so light and dark both work.
import Close from '@mui/icons-material/Close'
import Timer from '@mui/icons-material/TimerOutlined'
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, IconButton, Popover,
  Typography,
} from '@mui/material'
import { useEffect, useId, useRef, useState } from 'react'
import { useSession } from '../auth/sessionContext.js'
import { useSessionFlag } from '../lib/demoSession.js'
import { isPublicDemo } from '../lib/permissions.js'

const URGENT_AT = 60
const POPOVER_TEXT = "Public demo admin. Some actions are disabled, and you'll be signed out when the timer ends."
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

function spoken(seconds) {
  const s = Math.max(0, seconds)
  return `${plural(Math.floor(s / 60), 'minute')} ${plural(s % 60, 'second')}`
}

/** The countdown pill; `notice` comes from useDemoNotice(user). */
export function DemoPill({ notice }) {
  const [anchor, setAnchor] = useState(null)
  const [announcement, setAnnouncement] = useState('')
  const announced = useRef(false)
  const popoverId = useId()
  const left = notice.secondsLeft
  const urgent = left != null && left <= URGENT_AT
  // Once, the first time the time left is seen at or below 1:00 (also right after a hidden tab wakes up).
  useEffect(() => {
    if (notice.active && urgent && left > 0 && !announced.current) {
      announced.current = true
      setAnnouncement('1 minute left in the demo session')
    }
  }, [notice.active, urgent, left])
  if (!notice.active) return null
  return (
    <>
      <Button size="small" variant="outlined" color={urgent ? 'error' : 'warning'} data-urgent={String(urgent)}
        aria-haspopup="dialog" aria-expanded={anchor ? 'true' : undefined} aria-controls={anchor ? popoverId : undefined}
        aria-label={left == null ? 'Demo session' : `Demo session, signed out in ${spoken(left)}`}
        startIcon={<Timer />} onClick={(e) => setAnchor(e.currentTarget)}
        sx={{ ml: 1, flexShrink: 0, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', minWidth: 0,
          '& .MuiButton-startIcon': { mr: { xs: 0.5, sm: 1 } } }}>
        <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>Demo session · </Box>{notice.clock}
      </Button>
      <Popover id={popoverId} open={Boolean(anchor)} anchorEl={anchor} onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
        <Typography variant="body2" sx={{ p: 2, maxWidth: 280 }}>{POPOVER_TEXT}</Typography>
      </Popover>
      <Box role="status" aria-live="polite" aria-atomic="true"
        sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>
        {announcement}
      </Box>
    </>
  )
}

/** "Demo access · ..." under a page header, for public demo sessions only. A `dismissible` one can be hidden for
 * the rest of the session. */
export function DemoAccessNotice({ text, dismissible = false }) {
  const { user } = useSession()
  const [hidden, setHidden] = useSessionFlag('access-notice-hidden', user)
  if (!isPublicDemo(user) || (dismissible && hidden)) return null
  return (
    <Alert severity="warning" variant="outlined" sx={{ mb: 2, bgcolor: 'background.paper', alignItems: 'center' }}
      action={dismissible ? (
        <IconButton size="small" color="inherit" aria-label="Hide demo access notice" onClick={() => setHidden(true)}>
          <Close fontSize="small" /></IconButton>) : undefined}>
      {text}
    </Alert>
  )
}

/** Shown once per demo session, right after sign-in. */
export function DemoWelcome({ notice }) {
  const titleId = useId()
  return (
    <Dialog open={notice.welcomeOpen} onClose={notice.closeWelcome} aria-labelledby={titleId} maxWidth="xs" fullWidth>
      <DialogTitle id={titleId}>Welcome to the public demo admin</DialogTitle>
      <DialogContent>
        <DialogContentText>
          This is a public demo admin account for presentation purposes. Some actions are disabled, and you'll be
          signed out automatically in 5 minutes.
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={notice.closeWelcome} autoFocus>Got it</Button>
      </DialogActions>
    </Dialog>
  )
}
