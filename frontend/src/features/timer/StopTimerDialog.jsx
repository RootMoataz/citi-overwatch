import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material'
import { useId, useState } from 'react'
import { useStopTimer } from '../../api/queries.js'
import { useToast } from '../../app/toast.js'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import { formatHours } from '../../lib/format.js'
import { NOTE_MAX, NOTE_MIN, announceStop, formatElapsed, hoursIfStopped, isProofNote, weekdayName } from './timerClock.js'

/** Stop the running timer, with an optional work note (10-500 characters counts as proof of work). */
export default function StopTimerDialog({ timer, elapsed, onClose }) {
  const titleId = useId()
  const stop = useStopTimer()
  const toast = useToast()
  const [note, setNote] = useState('')
  const [failure, setFailure] = useState(null)
  const trimmed = note.trim()
  const tooShort = trimmed.length > 0 && !isProofNote(trimmed)
  const hours = hoursIfStopped(elapsed)
  const confirm = async () => {
    setFailure(null)
    try {
      announceStop(toast, await stop.mutateAsync(trimmed))
      onClose()
    } catch (err) { setFailure(err) }
  }
  return (
    <Dialog open onClose={stop.isPending ? undefined : onClose} aria-labelledby={titleId} maxWidth="xs" fullWidth>
      <DialogTitle id={titleId}>Stop your timer?</DialogTitle>
      <DialogContent>
        <Stack sx={{ gap: 2, pt: 1 }}>
          <Typography variant="body2">
            {timer.milestone.name} · {timer.project.name} · running {formatElapsed(elapsed)}.{' '}
            {hours ? `Stopping now adds ${formatHours(hours)} to ${weekdayName(timer.work_date)}'s cell on your timesheet. `
              + 'It isn\'t submitted until you press Submit there.'
              : 'Under 7.5 minutes, so stopping now adds nothing.'}
          </Typography>
          <ErrorAlert error={failure} />
          <TextField label="What did you work on?" multiline minRows={2} value={note} autoFocus
            onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))} error={tooShort}
            helperText={tooShort ? `At least ${NOTE_MIN} characters to count as a work note`
              : `Optional. It pre-fills the cell's work note (${NOTE_MIN}-${NOTE_MAX} characters), which Submit needs unless you post a progress update that day.`}
            slotProps={{ htmlInput: { maxLength: NOTE_MAX } }} />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={stop.isPending}>Keep running</Button>
        <Button variant="contained" color="error" onClick={confirm} disabled={stop.isPending || tooShort}>
          {stop.isPending ? 'Stopping…' : 'Stop timer'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
