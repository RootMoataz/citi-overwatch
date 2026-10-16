import { useEffect, useId, useLayoutEffect, useRef } from 'react'
import { Box, Button, Dialog, Stack, Typography } from '@mui/material'
import { useMediaQuery } from 'react-responsive'
import { DESKTOP_QUERY } from '../lib/responsive.js'

function PanelHeader({ id, title, titleAdornment, actions, onClose }) {
  const titleRef = useRef(null)
  useEffect(() => { titleRef.current?.focus() }, [])
  return (
    <Stack sx={{ flexDirection: 'row', alignItems: 'center', gap: 1, p: 2, borderBottom: 1, borderColor: 'divider' }}>
      <Typography ref={titleRef} id={id} variant="h2" component="h2" tabIndex={-1}
        sx={{ fontSize: '1.125rem', flex: 1, minWidth: 0, overflowWrap: 'anywhere', outline: 'none' }}>{title}</Typography>
      {titleAdornment}
      {actions}
      <Button onClick={onClose} sx={{ minHeight: 44, minWidth: 44 }}>Close</Button>
    </Stack>
  )
}

/**
 * A list with a detail panel beside it (1fr : 1fr from 900 px) or over it as a full-screen sheet on phones. The title
 * takes focus on open; Esc and Close call `onClose`; afterwards focus goes to `returnFocus?.()` or where it was.
 */
export default function SidePanel({ open, title, titleAdornment, actions, onClose, returnFocus, list, children }) {
  const desktop = useMediaQuery(DESKTOP_QUERY)
  const titleId = useId()
  const prior = useRef(null)
  const wasOpen = useRef(false)

  // Layout effects run before any child's focus move, so this still sees the element that opened the panel.
  useLayoutEffect(() => {
    if (open && !wasOpen.current) prior.current = document.activeElement
  }, [open])
  useEffect(() => {
    if (!open && wasOpen.current) {
      const target = returnFocus?.() ?? prior.current
      if (target && target !== document.body) target.focus?.()
    }
    wasOpen.current = Boolean(open)
  })

  const header = <PanelHeader id={titleId} title={title} titleAdornment={titleAdornment} actions={actions} onClose={onClose} />

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
