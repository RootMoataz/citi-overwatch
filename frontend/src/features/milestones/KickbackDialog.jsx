import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField,
} from '@mui/material'
import { useId, useState } from 'react'
import { useMediaQuery } from 'react-responsive'
import { useKickBack } from '../../api/workflow.js'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import { KICKBACK_CATEGORY, KICKBACK_REASON } from '../../lib/labels.js'
import { DESKTOP_QUERY } from '../../lib/responsive.js'
import { kickbackReasonError } from '../../lib/workflow.js'

/** An assignee sends a milestone back to its manager with a category and a reason. */
export default function KickbackDialog({ milestone, onClose }) {
  const titleId = useId()
  const desktop = useMediaQuery(DESKTOP_QUERY)
  const kick = useKickBack(milestone.project_id, milestone.id)
  const [category, setCategory] = useState('blocker')
  const [reason, setReason] = useState('')
  const [error, setError] = useState(null)
  const [failure, setFailure] = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    const problem = kickbackReasonError(reason)
    setError(problem)
    if (problem) return
    setFailure(null)
    try {
      await kick.mutateAsync({ category, reason: reason.trim() })
      onClose()
    } catch (err) { setFailure(err) }
  }

  return (
    <Dialog open onClose={kick.isPending ? undefined : onClose} aria-labelledby={titleId} fullScreen={!desktop}
      maxWidth="sm" fullWidth>
      <form noValidate onSubmit={submit}>
        <DialogTitle id={titleId}>Kick back {milestone.name}</DialogTitle>
        <DialogContent>
          <Alert severity="info" sx={{ mb: 2 }}>
            The milestone becomes Blocked until your manager reviews it. They'll see your reason straight away.
          </Alert>
          <ErrorAlert error={failure} sx={{ mb: 2 }} />
          <Stack sx={{ gap: 2 }}>
            <TextField select label="What's wrong?" value={category} onChange={(e) => setCategory(e.target.value)}
              disabled={kick.isPending}>
              {Object.entries(KICKBACK_CATEGORY).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
            </TextField>
            <TextField label="Explain" required multiline minRows={4} value={reason} disabled={kick.isPending}
              onChange={(e) => { setReason(e.target.value); setError(null) }} error={Boolean(error)}
              helperText={error || `What's blocking you and what you need. ${reason.trim().length}/${KICKBACK_REASON.max}`} />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose} disabled={kick.isPending}>Cancel</Button>
          <Button type="submit" variant="contained" color="error" disabled={kick.isPending}>
            {kick.isPending ? 'Sending…' : 'Kick back'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
