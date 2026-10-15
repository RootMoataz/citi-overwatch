import ContentCopy from '@mui/icons-material/ContentCopy'
import {
  Alert, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, Stack, Tooltip, Typography,
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

const NOT_SENT = "The email couldn't be sent. Copy these now and share them securely — the password won't be shown again."

/**
 * When email can't be sent, the admin sees the sign-in details exactly once to pass on directly.
 * `requireAck`: Done stays disabled, and Esc or a click outside does nothing, until "I've saved it" is ticked
 * (Puppy's create-accounts flow). `notice` replaces the warning; `progress` (e.g. "2 of 4 · Ada Lovelace") sits under
 * the title.
 */
export default function ShowOnceDialog({ username, password, onClose, requireAck = false, notice = NOT_SENT, progress }) {
  const titleId = useId()
  const [saved, setSaved] = useState(false)
  const closable = !requireAck || saved
  return (
    <Dialog open onClose={closable ? onClose : undefined} aria-labelledby={titleId} maxWidth="xs" fullWidth>
      <DialogTitle id={titleId}>Share these sign-in details</DialogTitle>
      <DialogContent>
        <Stack sx={{ gap: 1.5 }}>
          {progress ? <Typography variant="subtitle2">{progress}</Typography> : null}
          <Alert severity="warning">{notice}</Alert>
          <Secret label="Username" value={username} />
          <Secret label="Temporary password" value={password} />
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>It expires in 72 hours and must be changed at first sign-in.</Typography>
          {requireAck ? (
            <FormControlLabel control={<Checkbox checked={saved} onChange={(e) => setSaved(e.target.checked)} />}
              label="I've saved it" />
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}><Button variant="contained" onClick={onClose} disabled={!closable}>Done</Button></DialogActions>
    </Dialog>
  )
}
