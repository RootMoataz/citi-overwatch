// What a public demo admin sees: one countdown pill in the top bar (a button with a popover and a once-only
// screen-reader warning at 1:00), a notice on the pages the demo restricts, and a one-time welcome after sign-in.
// Colours come from the theme (demoTone), so light and dark both work.
import Close from '@mui/icons-material/Close'
import Timer from '@mui/icons-material/TimerOutlined'
import {
  Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, IconButton, Popover, Typography,
} from '@mui/material'
import { visuallyHidden } from '@mui/utils'
import { useEffect, useId, useRef, useState } from 'react'
import { useMediaQuery } from 'react-responsive'
import { useSession } from '../auth/sessionContext.js'
import { demoTone, useSessionFlag } from '../lib/demoSession.js'
import { isPublicDemo } from '../lib/permissions.js'
import { WIDE_QUERY } from '../lib/responsive.js'

const URGENT_AT = 60
const POPOVER_TEXT = "Public demo admin. Some actions are disabled, and you'll be signed out when the timer ends."
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

function spoken(seconds) {
  const s = Math.max(0, seconds)
  return `${plural(Math.floor(s / 60), 'minute')} ${plural(s % 60, 'second')}`
}

/** The countdown pill; `notice` comes from useDemoNotice(user). Below lg (phones, and a desktop with the sidebar open,
 * where the bar is short of room) it shows the timer icon and m:ss only, and its name then starts with that m:ss. */
export function DemoPill({ notice }) {
  const wide = useMediaQuery(WIDE_QUERY)
  const [anchor, setAnchor] = useState(null)
  const [announcement, setAnnouncement] = useState('')
  // The name a screen reader got when the pill took focus; it holds still until focus leaves, so the time isn't
  // re-read every second while someone sits on the pill.
  const [heldName, setHeldName] = useState(null)
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
  // The region empties itself shortly after speaking, so a repeat would be visible (and heard again).
  useEffect(() => {
    if (!announcement) return undefined
    const timer = setTimeout(() => setAnnouncement(''), 5000)
    return () => clearTimeout(timer)
  }, [announcement])
  if (!notice.active) return null
  // The name holds what the pill shows (label in name, for speech control): "Demo session…" on the full pill, the m:ss
  // first on the compact one (both start with their visible text).
  const name = left == null ? 'Demo session'
    : wide ? `Demo session · ${notice.clock}, signed out in ${spoken(left)}`
      : `${notice.clock} left in the demo session, signed out in ${spoken(left)}`
  // One run of text: split over two flex items, the space after "·" would collapse.
  const label = wide ? `Demo session · ${notice.clock}` : notice.clock
  return (
    <>
      <Button size="small" data-urgent={String(urgent)} startIcon={<Timer />}
        aria-haspopup="dialog" aria-expanded={anchor ? 'true' : undefined} aria-controls={anchor ? popoverId : undefined}
        aria-label={heldName ?? name} onFocus={() => setHeldName(name)} onBlur={() => setHeldName(null)}
        onClick={(e) => setAnchor(e.currentTarget)}
        sx={(theme) => {
          const tone = demoTone(theme, { urgent })
          return { flexShrink: 0, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', minWidth: 0, borderRadius: 999,
            px: wide ? 1.5 : 1, color: tone.text, bgcolor: tone.fill, '&:hover': { bgcolor: tone.hover },
            '& .MuiButton-startIcon': { mr: 0.5, ml: 0 } }
        }}>
        {label}
      </Button>
      <Popover id={popoverId} open={Boolean(anchor)} anchorEl={anchor} onClose={() => setAnchor(null)}
        slotProps={{ paper: { role: 'dialog', 'aria-label': 'About the demo session' } }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
        <Box sx={{ p: 2, maxWidth: 280 }}>
          <Typography variant="body2">{POPOVER_TEXT}</Typography>
          {/* The page behind an open popover is hidden from screen readers, 1:00 announcement included: say it here. */}
          {left == null ? null : (
            <Typography variant="body2" sx={{ mt: 1, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
              {`Time left: ${notice.clock}`}
            </Typography>
          )}
        </Box>
      </Popover>
      <Box role="status" aria-live="polite" aria-atomic="true" sx={visuallyHidden}>{announcement}</Box>
    </>
  )
}

/** "Demo access · ..." under a page header, for public demo sessions only: a tinted box with a timer icon and
 * "Demo access" in bold. A `dismissible` one can be hidden for the rest of the session; `page` keys that choice, so
 * hiding one page's notice never hides another's. */
export function DemoAccessNotice({ text, page, dismissible = false }) {
  const { user } = useSession()
  const labelId = useId()
  const [hidden, setHidden] = useSessionFlag(`access-notice-hidden:${page ?? 'page'}`, user)
  if (!isPublicDemo(user) || (dismissible && hidden)) return null
  const [lead, ...rest] = text.split(' · ')
  return (
    <Box role="note" aria-labelledby={labelId}
      sx={(theme) => {
        const tone = demoTone(theme)
        return { display: 'flex', alignItems: 'center', gap: 1.25, mb: 2, px: 2, py: 1.25, borderRadius: 1, border: 1,
          borderColor: tone.edge, bgcolor: tone.fill, color: tone.text, typography: 'body2' }
      }}>
      <Timer fontSize="small" aria-hidden sx={{ flexShrink: 0 }} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box component="strong" id={labelId} sx={{ fontWeight: 700 }}>{lead}</Box>
        {rest.length ? ` · ${rest.join(' · ')}` : null}
      </Box>
      {dismissible ? (
        <IconButton size="small" color="inherit" aria-label="Hide demo access notice" onClick={() => setHidden(true)}
          sx={{ my: -0.5, mr: -1 }}>
          <Close fontSize="small" />
        </IconButton>
      ) : null}
    </Box>
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
