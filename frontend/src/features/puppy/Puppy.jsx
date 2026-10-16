import { Badge, Box, IconButton, Popover, Tooltip } from '@mui/material'
import { visuallyHidden } from '@mui/utils'
import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useMediaQuery } from 'react-responsive'
import { useNotifications } from '../../api/queries.js'
import { PuppyDock } from '../../app/puppyDock.js'
import { useSession } from '../../auth/sessionContext.js'
import { NARROW_QUERY } from '../../lib/responsive.js'
import PuppyFace from './PuppyFace.jsx'
import PuppyPanel from './PuppyPanel.jsx'
import { readSoundSettings, storeSoundSettings } from './soundSettings.js'
import { usePuppyAlerts, useTitleBadge } from './usePuppyAlerts.js'

/**
 * Puppy, Scout's rule-based assistant: a round button in the header beside the bell. It perks up (ears up, a dot)
 * while notifications are unread, alerts when new ones arrive (toast, announcement and the chosen sound), and opens
 * a panel that sums up what needs attention. It shares the bell's notifications query, so it adds no polling.
 * Under 375 px (inside Layout) the button moves into the account menu; the alerts and the panel stay the same.
 */
export default function Puppy() {
  const { user } = useSession()
  const notifications = useNotifications()
  const items = notifications.data ?? []
  const [settings, setSettings] = useState(readSoundSettings)
  const [anchor, setAnchor] = useState(null)
  const narrow = useMediaQuery(NARROW_QUERY)
  // An open conversation (Create user accounts) can hold off Esc or a click outside until the admin confirms.
  const guard = useRef(null)
  // The panel widens for that conversation; the popover then moves so it stays on screen.
  const popover = useRef(null)
  const reposition = useCallback(() => popover.current?.updatePosition(), [])
  const requestClose = () => { if (guard.current && guard.current() === false) return; setAnchor(null) }
  const { announcement, excitedAt } = usePuppyAlerts({ me: user?.id, notifications: notifications.data, settings })
  useTitleBadge(items.length, settings.titleBadge)

  const changeSettings = useCallback((next) => {
    storeSoundSettings(next)
    setSettings(next)
  }, [])

  const perked = items.length > 0
  const dock = useContext(PuppyDock)
  const docked = Boolean(dock) && narrow
  const openAt = useCallback((el) => setAnchor(el), [])
  useEffect(() => {
    if (!docked) return undefined
    dock({ open: openAt, icon: <PuppyFace size={24} perked={perked} /> })
    return () => dock(null)
  }, [docked, dock, openAt, perked])
  return (
    <>
      {docked ? null : (
        <Tooltip title="Puppy assistant">
          <IconButton aria-label="Puppy assistant" aria-haspopup="dialog" aria-expanded={Boolean(anchor)}
            data-perked={String(perked)} onClick={(e) => setAnchor(e.currentTarget)}
            sx={{ p: 0.5, flexShrink: 0, bgcolor: 'action.hover', '&:hover': { bgcolor: 'action.selected' } }}>
            <Badge variant="dot" color="warning" overlap="circular" invisible={!perked}
              slotProps={{ badge: { 'data-testid': perked ? 'puppy-badge' : undefined } }}>
              <PuppyFace size={30} perked={perked} excitedAt={excitedAt} />
            </Badge>
          </IconButton>
        </Tooltip>
      )}
      <Box role="status" aria-live="polite" data-testid="puppy-announcement" sx={visuallyHidden}>{announcement}</Box>
      <Popover open={Boolean(anchor)} anchorEl={anchor} onClose={requestClose} action={popover}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { role: 'dialog', 'aria-label': 'Puppy assistant', sx: { mt: 1, borderRadius: 3 } } }}>
        {anchor ? (
          <PuppyPanel user={user} notifications={items} settings={settings} onSettings={changeSettings}
            onClose={() => setAnchor(null)} guardRef={guard} onResize={reposition} />
        ) : null}
      </Popover>
    </>
  )
}
