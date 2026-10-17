import Lock from '@mui/icons-material/LockOutlined'
import Timer from '@mui/icons-material/TimerOutlined'
import {
  Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Stack, TextField, Tooltip,
  Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useId, useState } from 'react'
import { useRequestEdit } from '../../api/queries.js'
import Critical from '../../components/Critical.jsx'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import { formatHours } from '../../lib/format.js'

export const LOCK_HINT = "Timer hours can't be edited — request a change"
export const REASON_MIN = 10
export const REASON_MAX = 500
const HOURS_TEXT = /^\d{1,2}(\.\d{1,2})?$/

/** Ask the manager to change a locked cell's hours: the hours wanted (same rules as a cell: 0.25-24, two
 * decimals) and why (10-500 characters). */
export function RequestChangeDialog({ cell, onClose }) {
  const titleId = useId()
  const request = useRequestEdit()
  const [hours, setHours] = useState('')
  const [reason, setReason] = useState('')
  const [failure, setFailure] = useState(null)
  const value = Number(hours)
  const badHours = hours !== '' && (!HOURS_TEXT.test(hours) || value < 0.25 || value > 24)
  const same = hours !== '' && value === Number(cell.hours)
  const shortReason = reason.trim().length < REASON_MIN
  const send = async () => {
    setFailure(null)
    try {
      await request.mutateAsync({ milestone_id: cell.milestoneId, work_date: cell.date, requested_hours: hours,
        reason: reason.trim() })
      onClose()
    } catch (err) { setFailure(err) }
  }
  return (
    <Dialog open onClose={request.isPending ? undefined : onClose} aria-labelledby={titleId} maxWidth="xs" fullWidth>
      <DialogTitle id={titleId}>Request a change</DialogTitle>
      <DialogContent>
        <Stack sx={{ gap: 2, pt: 1 }}>
          <DialogContentText>
            {cell.label} holds {formatHours(cell.hours)} from your timer. Your manager approves the new hours before
            they replace them.
          </DialogContentText>
          <ErrorAlert error={failure} />
          <TextField label="Hours you want instead" value={hours} autoFocus required
            onChange={(e) => setHours(e.target.value.replace(/[^\d.]/g, '').slice(0, 5))}
            error={badHours || same}
            helperText={badHours ? 'Between 0.25 and 24 hours, at most 2 decimals' : same ? 'That is what the cell holds already' : ' '}
            slotProps={{ htmlInput: { inputMode: 'decimal' } }} />
          <TextField label="Why?" multiline minRows={3} value={reason} required
            onChange={(e) => setReason(e.target.value.slice(0, REASON_MAX))}
            error={reason.trim().length > 0 && shortReason}
            helperText={`${reason.trim().length}/${REASON_MAX} · at least ${REASON_MIN} characters`}
            slotProps={{ htmlInput: { maxLength: REASON_MAX } }} />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={request.isPending}>Cancel</Button>
        <Button variant="contained" onClick={send} disabled={request.isPending || hours === '' || badHours || same || shortReason}>
          {request.isPending ? 'Sending…' : 'Send request'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

/** A cell holding timer hours: the value read-only with a lock (the server refuses other hours), a timer mark while
 * some of it is a draft not submitted yet, and "Request a change" (or the request waiting for the manager). */
export default function LockedCell({ lock, label, onRequest, closed }) {
  const draft = Number(lock.draft_hours) > 0
  const pending = lock.request
  return (
    <Box>
      <Tooltip title={LOCK_HINT}>
        <Box role="group" aria-label={`${label}: ${formatHours(lock.hours)}, locked timer hours`} tabIndex={0}
          sx={(t) => ({ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, width: 76, height: 40,
            borderRadius: 1, border: 1, borderColor: draft ? 'info.main' : 'divider', fontVariantNumeric: 'tabular-nums',
            bgcolor: draft ? alpha(t.palette.info.main, 0.1) : 'action.hover', fontWeight: 600 })}>
          {draft ? <Timer sx={{ fontSize: 16, color: 'info.main' }} aria-hidden /> : <Lock sx={{ fontSize: 15, color: 'text.secondary' }} aria-hidden />}
          {formatHours(lock.hours)}
        </Box>
      </Tooltip>
      {draft ? (
        <Typography variant="caption" sx={{ display: 'block', color: 'info.main', lineHeight: 1.2, mt: 0.5 }}>
          from timer, not submitted yet
        </Typography>
      ) : null}
      {pending ? (
        <Tooltip title={`You asked for ${formatHours(pending.requested_hours)}: ${pending.reason}`}>
          <Chip size="small" color="warning" variant="outlined"
            label={<Critical>{`Change requested: ${formatHours(pending.requested_hours)}`}</Critical>}
            sx={{ mt: 0.5, height: 'auto', minHeight: 20, maxWidth: '100%',
              '& .MuiChip-label': { whiteSpace: 'normal', textAlign: 'center', lineHeight: 1.2, py: 0.25 } }} />
        </Tooltip>
      ) : !closed ? (
        <Button size="small" onClick={onRequest} aria-label={`Request a change, ${label}`}
          sx={{ mt: 0.25, minWidth: 0, px: 0.5, fontSize: '0.72rem', lineHeight: 1.2 }}>
          Request a change
        </Button>
      ) : null}
    </Box>
  )
}
