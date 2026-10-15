// What a public demo admin sees on every page: a banner with the time left (which can be tucked into a header chip
// but never goes away), and a one-time welcome right after sign-in. Theme colours come from MUI, so light and dark
// both work; nothing moves for people who ask for reduced motion.
import Close from '@mui/icons-material/Close'
import Timer from '@mui/icons-material/TimerOutlined'
import {
  Alert, Button, Chip, Collapse, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, IconButton,
} from '@mui/material'
import { useId } from 'react'
import { useCalmMotion } from '../lib/motion.js'

const signedOutIn = (clock) => (clock ? ` You'll be signed out in ${clock}.` : '')

/** The full-width notice at the top of the page; `notice` comes from useDemoNotice(user). */
export function DemoBanner({ notice }) {
  const calm = useCalmMotion()
  if (!notice.active) return null
  return (
    <Collapse in={!notice.hidden} timeout={calm ? 0 : 'auto'} unmountOnExit>
      <Alert severity="warning" variant="outlined" icon={<Timer />} role="region" aria-label="Demo session"
        sx={{ mb: 2, bgcolor: 'background.paper', alignItems: 'center' }}
        action={<IconButton size="small" color="inherit" aria-label="Hide demo notice" onClick={notice.hide}>
          <Close fontSize="small" /></IconButton>}>
        <strong>Demo admin</strong> — for demonstration only.{signedOutIn(notice.clock)}
      </Alert>
    </Collapse>
  )
}

/** The banner tucked away: a header chip that keeps counting and brings the banner back. */
export function DemoChip({ notice }) {
  if (!notice.active || !notice.hidden) return null
  return (
    <Chip icon={<Timer />} color="warning" variant="outlined" onClick={notice.show}
      label={notice.clock ? `Demo · ${notice.clock}` : 'Demo'}
      aria-label={`Demo admin: signed out in ${notice.clock ?? 'a few minutes'}. Show the demo notice`}
      sx={{ fontVariantNumeric: 'tabular-nums' }} />
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
