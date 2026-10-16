import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { Box, Button, Dialog, Stack, Typography } from '@mui/material'
import { useMediaQuery } from 'react-responsive'
import { DESKTOP_QUERY } from '../lib/responsive.js'

/** Whether `el` shows the focus ring now: a keyboard user's focus. jsdom and old browsers may not know the selector. */
function showsRing(el) {
  if (!el || el === document.body) return false
  try { return el.matches(':focus-visible') } catch { return false }
}

// The title is focused by script, so its ring follows the opener's: a keyboard user's ring carries over, while after a
// click or a landing from a link (where browsers may still count the focus as :focus-visible) it draws nothing.
const TITLE_FOCUS = {
  '&:focus:not(:focus-visible)': { outline: 'none' },
  '&[data-quiet-focus]:focus-visible': { outline: 'none' },
}

function PanelHeader({ id, title, titleAdornment, actions, onClose, quiet }) {
  const titleRef = useRef(null)
  useEffect(() => { titleRef.current?.focus() }, [])
  return (
    <Stack sx={{ flexDirection: 'row', alignItems: 'center', gap: 1, p: 2, borderBottom: 1, borderColor: 'divider' }}>
      <Typography ref={titleRef} id={id} variant="h2" component="h2" tabIndex={-1}
        data-quiet-focus={quiet ? '' : undefined} sx={{ fontSize: '1.125rem', flex: 1, minWidth: 0, overflowWrap: 'anywhere', ...TITLE_FOCUS }}>{title}</Typography>
      {titleAdornment}
      {actions}
      <Button onClick={onClose} sx={{ minHeight: 44, minWidth: 44 }}>Close</Button>
    </Stack>
  )
}

/**
 * A list with a detail panel beside it (1fr : 1fr from 900 px) or over it as a full-screen sheet on phones. The title
 * takes focus on open (its ring only for a keyboard opener); Esc and Close call `onClose`; afterwards focus goes to
 * `returnFocus?.()` or where it was.
 */
export default function SidePanel({ open, title, titleAdornment, actions, onClose, returnFocus, list, children }) {
  const desktop = useMediaQuery(DESKTOP_QUERY)
  const titleId = useId()
  const prior = useRef(null)
  const wasOpen = useRef(false)
  // Read while rendering the open, before the page changes: the opener may be re-drawn (and lose focus) by then.
  const [opening, setOpening] = useState({ open: false, ring: false })
  if (Boolean(open) !== opening.open) setOpening({ open: Boolean(open), ring: open ? showsRing(document.activeElement) : false })

  // Layout effects run before any child's focus move, so this still sees the element that opened the panel.
  useLayoutEffect(() => {
    if (open && !wasOpen.current) prior.current = document.activeElement
  }, [open])
  const restoreFocus = () => {
    const target = returnFocus?.() ?? prior.current
    if (target && target !== document.body) target.focus?.()
  }
  const restoreRef = useRef(restoreFocus)
  useEffect(() => {
    restoreRef.current = restoreFocus
    if (!open && wasOpen.current) restoreFocus()
    wasOpen.current = Boolean(open)
  })
  // Unmounting while open (the page navigates away) still gives focus back.
  useEffect(() => () => { if (wasOpen.current) restoreRef.current() }, [])

  const header = <PanelHeader id={titleId} title={title} titleAdornment={titleAdornment} actions={actions} onClose={onClose}
    quiet={!opening.ring} />

  if (!desktop) {
    return (
      <>
        {list}
        <Dialog open={Boolean(open)} fullScreen onClose={onClose} disableRestoreFocus aria-labelledby={titleId}>
          {header}
          <Box sx={{ p: 2, overflowY: 'auto' }}>{children}</Box>
        </Dialog>
      </>
    )
  }
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: open ? '1fr 1fr' : '1fr', gap: 2, alignItems: 'start' }}>
      <Box sx={{ minWidth: 0 }}>{list}</Box>
      {open ? (
        <Box component="aside" role="complementary" aria-labelledby={titleId}
          onKeyDown={(e) => { if (e.key === 'Escape' && !e.defaultPrevented) onClose() }}
          sx={{ minWidth: 0, border: 1, borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper' }}>
          {header}
          <Box sx={{ p: 2 }}>{children}</Box>
        </Box>
      ) : null}
    </Box>
  )
}
