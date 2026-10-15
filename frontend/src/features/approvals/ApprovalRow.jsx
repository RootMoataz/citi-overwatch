import { Box, Button, Chip, Collapse, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material'
import { useId, useState } from 'react'
import { useApproveEntry, useRejectEntry } from '../../api/queries.js'
import { STATUS, statusColor } from '../../app/theme.js'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import PersonLink from '../../components/PersonLink.jsx'
import UserAvatar from '../../components/UserAvatar.jsx'
import { formatDayLabel, formatHours } from '../../lib/format.js'
import { HR_CHANGED } from '../../lib/labels.js'
import BreakdownPanel from './BreakdownPanel.jsx'

function RejectDialog({ item, onClose }) {
  const titleId = useId()
  const reject = useRejectEntry()
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [failure, setFailure] = useState(null)
  const confirm = async () => {
    if (!reason.trim()) { setError('Tell the employee why'); return }
    try { await reject.mutateAsync({ id: item.entry.id, reason: reason.trim(), expectedHours: item.entry.hours }); onClose() } catch (err) { setFailure(err) }
  }
  return (
    <Dialog open onClose={reject.isPending ? undefined : onClose} aria-labelledby={titleId} maxWidth="xs" fullWidth>
      <DialogTitle id={titleId}>Reject these hours?</DialogTitle>
      <DialogContent>
        <Stack sx={{ gap: 2, pt: 1 }}>
          <Typography variant="body2">{item.user.name} sees your reason on their timesheet and can fix and resubmit.</Typography>
          <ErrorAlert error={failure} />
          <TextField label="Reason" required multiline minRows={2} value={reason} autoFocus error={Boolean(error)} helperText={error}
            onChange={(e) => { setReason(e.target.value); setError('') }} />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={reject.isPending}>Cancel</Button>
        <Button color="error" variant="contained" onClick={confirm} disabled={reject.isPending}>Reject</Button>
      </DialogActions>
    </Dialog>
  )
}

/** One pending entry: who, when, how much, the label, approve/reject, and the budget impact. */
export default function ApprovalRow({ item, showContext = true }) {
  const approve = useApproveEntry()
  const [open, setOpen] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [failure, setFailure] = useState(null)
  const tone = item.entry.over_40 ? STATUS.on_hold : STATUS.pending
  return (
    <Box sx={{ py: 1.5, borderTop: 1, borderColor: 'divider' }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 1, alignItems: { sm: 'center' } }}>
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="body2" component="div" sx={{ fontWeight: 600 }}>
            <UserAvatar userId={item.user.id} name={item.user.name}
              sx={{ display: 'inline-flex', verticalAlign: 'middle', mr: 1 }} />
            <PersonLink person={item.user} context={{ managed: true }} /> · {formatDayLabel(item.entry.work_date)} · {formatHours(item.entry.hours)}
            {showContext ? <Typography component="span" variant="body2" sx={{ color: 'text.secondary' }}> · {item.project.name} › {item.milestone.name}</Typography> : null}
          </Typography>
          <Typography variant="caption" sx={{ color: (t) => statusColor(tone, t) }}>{item.label}</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary', ml: 1 }}>{formatHours(item.week_logged_total)} this week</Typography>
          {item.entry.edited_after_decision ? <Typography variant="caption" sx={{ ml: 1 }}>· Edited</Typography> : null}
          {item.entry.changed_after_hr_submission ? (
            <Chip size="small" variant="outlined" color="warning" label={HR_CHANGED} sx={{ ml: 1, height: 20 }} />
          ) : null}
          {item.delegated_from ? (
            <Chip size="small" variant="outlined" color="info" label={`Delegated from ${item.delegated_from.name}`}
              sx={{ ml: 1, height: 20 }} />
          ) : null}
        </Box>
        <Stack direction="row" sx={{ gap: 1, flexShrink: 0 }}>
          <Button size="small" onClick={() => setOpen((o) => !o)} aria-expanded={open}>Budget impact</Button>
          <Button size="small" color="error" onClick={() => setRejecting(true)}>Reject</Button>
          <Button size="small" variant="contained" disabled={approve.isPending}
            onClick={async () => { setFailure(null); try { await approve.mutateAsync({ id: item.entry.id, expectedHours: item.entry.hours }) } catch (err) { setFailure(err) } }}>
            Approve
          </Button>
        </Stack>
      </Stack>
      <ErrorAlert error={failure} sx={{ mt: 1 }} />
      <Collapse in={open} unmountOnExit><Box sx={{ mt: 1 }}><BreakdownPanel entryId={item.entry.id} /></Box></Collapse>
      {rejecting ? <RejectDialog item={item} onClose={() => setRejecting(false)} /> : null}
    </Box>
  )
}
