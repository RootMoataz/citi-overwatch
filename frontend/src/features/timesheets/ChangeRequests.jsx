import {
  Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Paper, Stack, TextField, Typography,
} from '@mui/material'
import { useId, useState } from 'react'
import { useDecideEdit, useEditRequests } from '../../api/queries.js'
import { useSession } from '../../auth/sessionContext.js'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import PersonLink from '../../components/PersonLink.jsx'
import UserAvatar from '../../components/UserAvatar.jsx'
import { formatDayLabel, formatHours } from '../../lib/format.js'
import { isReadOnly } from '../../lib/permissions.js'

const COMMENT_MAX = 500

/** Approve or reject one change request, with an optional comment the employee sees. */
function DecideDialog({ request, approve, onClose }) {
  const titleId = useId()
  const decide = useDecideEdit()
  const [comment, setComment] = useState('')
  const [failure, setFailure] = useState(null)
  const first = request.user.name.split(' ')[0]
  const go = async () => {
    setFailure(null)
    try {
      await decide.mutateAsync({ id: request.id, approve, comment: comment.trim() })
      onClose()
    } catch (err) { setFailure(err) }
  }
  return (
    <Dialog open onClose={decide.isPending ? undefined : onClose} aria-labelledby={titleId} maxWidth="xs" fullWidth>
      <DialogTitle id={titleId}>{approve ? 'Approve' : 'Reject'} {first}&apos;s change?</DialogTitle>
      <DialogContent>
        <Stack sx={{ gap: 2, pt: 1 }}>
          <DialogContentText>
            {request.milestone.name}, {formatDayLabel(request.work_date)}: {formatHours(request.current_hours)} →{' '}
            {formatHours(request.requested_hours)}.{' '}
            {approve ? `The cell becomes ${formatHours(request.requested_hours)}, waiting for approval like any other hours.`
              : 'The cell keeps its timer hours.'} {first} is told either way.
          </DialogContentText>
          <ErrorAlert error={failure} />
          <TextField label={`Comment for ${first} (optional)`} multiline minRows={2} value={comment} autoFocus
            onChange={(e) => setComment(e.target.value.slice(0, COMMENT_MAX))}
            slotProps={{ htmlInput: { maxLength: COMMENT_MAX } }} />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={decide.isPending}>Cancel</Button>
        <Button variant="contained" color={approve ? 'primary' : 'error'} onClick={go} disabled={decide.isPending}>
          {approve ? 'Approve change' : 'Reject change'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

/** "Change requests": employees asking to change hours their timer tracked (locked cells). Managers decide their
 * projects' (and delegated ones), admins everyone's. Hidden while there are none. */
export default function ChangeRequests() {
  const { user } = useSession()
  const requests = useEditRequests('pending', !isReadOnly(user))
  const [deciding, setDeciding] = useState(null)
  const titleId = useId()
  const items = requests.data ?? []
  if (!items.length && !requests.error) return null
  return (
    <Paper component="section" variant="outlined" aria-labelledby={titleId} id="change-requests" sx={{ p: 2, mb: 2 }}>
      <Typography id={titleId} variant="h3" component="h2" sx={{ mb: 0.5 }}>Change requests</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }}>
        Timer hours are locked; people ask here to change them.
      </Typography>
      <ErrorAlert error={requests.error} onRetry={() => requests.refetch()} />
      <Box component="ul" aria-label="Change requests" sx={{ listStyle: 'none', p: 0, m: 0 }}>
        {items.map((r) => (
          <Box component="li" key={r.id} sx={{ py: 1.25, borderTop: 1, borderColor: 'divider', '&:first-of-type': { borderTop: 0, pt: 0 } }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 1.5, alignItems: { sm: 'center' } }}>
              <Stack direction="row" sx={{ gap: 1.25, alignItems: 'flex-start', minWidth: 0, flexGrow: 1 }}>
                <UserAvatar userId={r.user.id} name={r.user.name} size={36} />
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="subtitle2" component="p">
                    <PersonLink person={r.user} context={{ managed: true }} /> · {r.milestone.name} · {formatDayLabel(r.work_date)}
                  </Typography>
                  <Typography variant="body2" component="p">
                    <Box component="span" sx={{ fontWeight: 700 }}>{formatHours(r.current_hours)} → {formatHours(r.requested_hours)}</Box>
                    <Box component="span" sx={{ color: 'text.secondary' }}> · {r.project.name}</Box>
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'text.secondary', overflowWrap: 'anywhere' }}>“{r.reason}”</Typography>
                </Box>
              </Stack>
              {r.can_decide ? (
                <Stack direction="row" sx={{ gap: 1, flexShrink: 0 }}>
                  <Button size="small" variant="contained" aria-label={`Approve ${r.user.name}'s change`}
                    onClick={() => setDeciding({ request: r, approve: true })}>Approve</Button>
                  <Button size="small" variant="outlined" color="error" aria-label={`Reject ${r.user.name}'s change`}
                    onClick={() => setDeciding({ request: r, approve: false })}>Reject</Button>
                </Stack>
              ) : null}
            </Stack>
          </Box>
        ))}
      </Box>
      {deciding ? <DecideDialog {...deciding} onClose={() => setDeciding(null)} /> : null}
    </Paper>
  )
}
