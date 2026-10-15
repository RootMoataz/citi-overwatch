import Print from '@mui/icons-material/PrintOutlined'
import { Box, Button, Typography } from '@mui/material'
import { flushSync } from 'react-dom'
import { startPrinting, usePrinting } from '../app/colorMode.js'
import { useSession } from '../auth/sessionContext.js'
import { fullName } from '../lib/format.js'

/** Opens the browser's print dialog (where "Save as PDF" lives). The page switches to the light theme first. */
export function PrintButton() {
  const print = () => {
    flushSync(startPrinting)
    window.print()
  }
  return <Button size="small" variant="outlined" startIcon={<Print />} onClick={print}>Print / PDF</Button>
}

const roleLabel = (role) => (role ? role[0].toUpperCase() + role.slice(1) : '')

/** A small header that only appears on paper: what the page is, who printed it (and their role) and when. */
export function PrintHeader({ title }) {
  const { user } = useSession()
  usePrinting() // re-render when printing starts, so the time below is the time of printing
  const printedAt = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
  return (
    <Box data-print="only" sx={{ display: 'none', mb: 2, pb: 1, borderBottom: '1px solid #D5DDE7', color: '#111C27' }}>
      <Typography variant="caption" component="p" sx={{ fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
        Citi Overwatch
      </Typography>
      <Typography variant="h3" component="p">{title}</Typography>
      <Typography variant="caption" component="p">
        Printed by {fullName(user)} ({roleLabel(user?.role)}) on {printedAt}
      </Typography>
    </Box>
  )
}
