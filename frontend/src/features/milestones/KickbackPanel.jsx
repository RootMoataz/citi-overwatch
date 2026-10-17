import PanTool from '@mui/icons-material/PanToolOutlined'
import { Alert, AlertTitle, Box, Button, Stack, TextField, Typography } from '@mui/material'
import { useState } from 'react'
import { useResolveKickback } from '../../api/workflow.js'
import Critical from '../../components/Critical.jsx'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import { relativeTime } from '../../lib/relativeTime.js'

const MAX = 2000

/** The open kickback on a blocked milestone: everyone on it sees why; the manager (or delegate, or an admin) replies
 * with instructions and returns it to the team or puts it back in the queue, after editing or reassigning it if
 * needed. */
export default function KickbackPanel({ milestone, onEdit }) {
  const kickback = milestone.open_kickback
  const resolve = useResolveKickback(milestone.project_id, milestone.id)
  const [note, setNote] = useState('')
  const [error, setError] = useState(null)
  const [failure, setFailure] = useState(null)
  if (!kickback) return null

  const act = async (resolution) => {
    const text = note.trim()
    if (!text) { setError('Write your instructions or decision first'); return }
    if (text.length > MAX) { setError(`Keep it under ${MAX} characters`); return }
    setFailure(null)
    try { await resolve.mutateAsync({ resolution, note: text }); setNote('') } catch (err) { setFailure(err) }
  }

  return (
    <Alert severity="error" icon={<PanTool />} sx={{ mt: 1.5, '& .MuiAlert-message': { width: '100%' } }}
      aria-label={`Kickback on ${milestone.name}`}>
      <AlertTitle><Critical>Kicked back</Critical>: {kickback.category_label}</AlertTitle>
      <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{kickback.reason}</Typography>
      <Typography variant="caption" sx={{ display: 'block', mt: 0.5, opacity: 0.85 }}>
        {kickback.raised_by.name} · <time dateTime={kickback.raised_at}>{relativeTime(kickback.raised_at)}</time>
        {milestone.can_resolve_kickback ? null : <>{' · '}<Critical>waiting for the manager’s review</Critical></>}
      </Typography>
      {milestone.can_resolve_kickback ? (
        <Box sx={{ mt: 1.5 }}>
          <TextField label="Reply with instructions" multiline minRows={2} value={note} disabled={resolve.isPending}
            onChange={(e) => { setNote(e.target.value); setError(null) }} error={Boolean(error)}
            helperText={error || 'Sent to the people on the milestone with your decision.'}
            sx={{ bgcolor: 'background.paper', borderRadius: 1 }} />
          <ErrorAlert error={failure} sx={{ mt: 1 }} />
          <Stack direction="row" useFlexGap sx={{ gap: 1, mt: 1, flexWrap: 'wrap' }}>
            <Button size="small" variant="contained" disabled={resolve.isPending} onClick={() => act('returned')}>
              Return to employee
            </Button>
            <Button size="small" variant="outlined" disabled={resolve.isPending} onClick={() => act('requeued')}>
              Put back in the queue
            </Button>
            {onEdit ? (
              <Button size="small" disabled={resolve.isPending} onClick={() => onEdit(milestone)}>Edit or reassign</Button>
            ) : null}
          </Stack>
        </Box>
      ) : null}
    </Alert>
  )
}
