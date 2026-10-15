import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material'
import { useId } from 'react'

export default function ConfirmDialog({ open, title, body, confirmLabel = 'Confirm', destructive = true,
  busy = false, onConfirm, onClose, children }) {
  const titleId = useId()
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} aria-labelledby={titleId} maxWidth="xs" fullWidth>
      <DialogTitle id={titleId}>{title}</DialogTitle>
      {body || children ? (
        <DialogContent>
          {body ? <DialogContentText>{body}</DialogContentText> : null}
          {children}
        </DialogContent>
      ) : null}
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={onConfirm} variant="contained" color={destructive ? 'error' : 'primary'} disabled={busy}>
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
