import ContentCopy from '@mui/icons-material/ContentCopy'
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Stack, Tooltip, Typography,
} from '@mui/material'
import { useId, useState } from 'react'

function Secret({ label, value }) {
  const [copied, setCopied] = useState(false)
  return (
    <Stack direction="row" sx={{ alignItems: 'center', gap: 1, p: 1.5, borderRadius: 1, bgcolor: 'action.hover' }}>
      <Stack sx={{ flexGrow: 1, minWidth: 0 }}>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>{label}</Typography>
        <Typography variant="body1" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{value}</Typography>
      </Stack>
      <Tooltip title={copied ? 'Copied' : `Copy ${label.toLowerCase()}`}>
        <IconButton aria-label={`Copy ${label.toLowerCase()}`}
          onClick={async () => { try { await navigator.clipboard.writeText(value); setCopied(true) } catch { setCopied(false) } }}>
          <ContentCopy />
        </IconButton>
      </Tooltip>
    </Stack>
  )
}

/** When email can't be sent, the admin sees the sign-in details exactly once to pass on directly. */
export default function ShowOnceDialog({ username, password, onClose }) {
  const titleId = useId()
  return (
    <Dialog open onClose={onClose} aria-labelledby={titleId} maxWidth="xs" fullWidth>
      <DialogTitle id={titleId}>Share these sign-in details</DialogTitle>
      <DialogContent>
        <Stack sx={{ gap: 1.5 }}>
          <Alert severity="warning">The email couldn't be sent. Copy these now and share them securely — the password won't be shown again.</Alert>
          <Secret label="Username" value={username} />
          <Secret label="Temporary password" value={password} />
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>It expires in 72 hours and must be changed at first sign-in.</Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}><Button variant="contained" onClick={onClose}>Done</Button></DialogActions>
    </Dialog>
  )
}
