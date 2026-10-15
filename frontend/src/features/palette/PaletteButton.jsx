import Search from '@mui/icons-material/Search'
import { Box, ButtonBase, IconButton, Tooltip, useMediaQuery } from '@mui/material'
import { useEffect, useState } from 'react'
import CommandPalette from './CommandPalette.jsx'
import { typingIn } from './search.js'

const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '')

/**
 * The header's search pill ("Search… Ctrl K"; an icon on phones) and the command palette it opens. It also owns
 * the global shortcuts: Ctrl+K (Cmd+K on a Mac) anywhere, and "/" when the focus isn't in a field.
 */
export default function PaletteButton() {
  const [open, setOpen] = useState(false)
  const phone = useMediaQuery((theme) => theme.breakpoints.down('sm'))
  const shortcut = isMac() ? '⌘K' : 'Ctrl K'

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      } else if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !typingIn(e.target)) {
        e.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const label = `Search (${shortcut})`
  return (
    <>
      {phone ? (
        <Tooltip title={label}>
          <IconButton color="inherit" aria-label={label} aria-haspopup="dialog" onClick={() => setOpen(true)}><Search /></IconButton>
        </Tooltip>
      ) : (
        <ButtonBase aria-label={label} aria-haspopup="dialog" onClick={() => setOpen(true)}
          sx={{ gap: 1, px: 1.5, height: 36, minWidth: 200, justifyContent: 'flex-start', borderRadius: 999,
            border: 1, borderColor: 'divider', color: 'text.secondary', bgcolor: 'action.hover', fontSize: 14,
            transition: 'border-color 150ms, background-color 150ms',
            '&:hover': { borderColor: 'text.secondary' }, '&:focus-visible': { outline: 2, outlineColor: 'primary.main', outlineOffset: 2 } }}>
          <Search fontSize="small" />
          <Box component="span" sx={{ flex: 1, textAlign: 'left' }}>Search…</Box>
          <Box component="kbd" aria-hidden sx={{ fontFamily: 'inherit', fontSize: 12, px: 0.75, py: 0.125, borderRadius: 1,
            border: 1, borderColor: 'divider', bgcolor: 'background.paper', color: 'text.secondary' }}>{shortcut}</Box>
        </ButtonBase>
      )}
      <CommandPalette open={open} onClose={() => setOpen(false)} />
    </>
  )
}
