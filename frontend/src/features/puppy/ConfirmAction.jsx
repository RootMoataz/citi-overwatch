import { Box, Button, Stack, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useEffect, useRef } from 'react'

/** The confirmation step every Puppy action goes through: what will happen, then Confirm or Cancel. */
export default function ConfirmAction({ action, onConfirm, onCancel, busy = false }) {
  const confirmRef = useRef(null)
  useEffect(() => { confirmRef.current?.focus() }, [action.id])
  return (
    <Box role="group" aria-label={`Confirm: ${action.label}`}
      sx={(theme) => ({ p: 1.5, borderRadius: 2, border: 1, borderColor: 'primary.main', bgcolor: alpha(theme.palette.primary.main, 0.06) })}>
      <Typography variant="body2">{action.confirm}</Typography>
      <Stack direction="row" sx={{ gap: 1, mt: 1, justifyContent: 'flex-end' }}>
        <Button size="small" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button size="small" variant="contained" ref={confirmRef} onClick={onConfirm} disabled={busy}>Confirm</Button>
      </Stack>
    </Box>
  )
}
