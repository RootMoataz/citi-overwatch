import Add from '@mui/icons-material/Add'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  Button, Card, CardActions, CardContent, Dialog, DialogActions, DialogContent, DialogTitle, Grid, InputAdornment, Stack,
  Tab, Tabs, TextField, Typography,
} from '@mui/material'
import { useId, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useMediaQuery } from 'react-responsive'
import { useNavigate } from 'react-router-dom'
import { useApproveRequest, useRejectRequest, useRequests, useSubmitRequest } from '../../api/queries.js'
import { useSession } from '../../auth/sessionContext.js'
import EmptyState from '../../components/EmptyState.jsx'
import { useRedirectOnDenied } from '../../app/access.js'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import PageHeader from '../../components/PageHeader.jsx'
import PersonLink from '../../components/PersonLink.jsx'
import StatusChip from '../../components/StatusChip.jsx'
import { formatDate, formatMoney } from '../../lib/format.js'
import { can } from '../../lib/permissions.js'
import { DESKTOP_QUERY } from '../../lib/responsive.js'
import { requestSchema } from '../../lib/schemas.js'

function RequestForm({ onClose }) {
  const titleId = useId()
  const desktop = useMediaQuery(DESKTOP_QUERY)
  const submit = useSubmitRequest()
  const [failure, setFailure] = useState(null)
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(requestSchema),
    defaultValues: { name: '', description: '', proposed_start: '', proposed_end: '', proposed_budget: '', reason: '' },
  })
  const field = (name, label, extra = {}) => (
    <TextField label={label} {...register(name)} error={Boolean(errors[name])} helperText={errors[name]?.message ?? extra.helper}
      disabled={isSubmitting} {...extra.props} />
  )
  return (
    <Dialog open onClose={isSubmitting ? undefined : onClose} aria-labelledby={titleId} fullScreen={!desktop} maxWidth="sm" fullWidth>
      <form noValidate onSubmit={handleSubmit(async (values) => {
        setFailure(null)
        try { await submit.mutateAsync(values); onClose() } catch (err) { setFailure(err) }
      })}>
        <DialogTitle id={titleId}>Request a project</DialogTitle>
        <DialogContent>
          <ErrorAlert error={failure} sx={{ mb: 2 }} />
          <Grid container spacing={2} sx={{ pt: 1 }}>
            <Grid size={12}>{field('name', 'Name', { props: { required: true, autoFocus: true } })}</Grid>
            <Grid size={12}>{field('description', 'Description', { props: { multiline: true, minRows: 2 } })}</Grid>
            <Grid size={{ xs: 12, sm: 6 }}>{field('proposed_start', 'Proposed start', { props: { type: 'date', required: true, slotProps: { inputLabel: { shrink: true } } } })}</Grid>
            <Grid size={{ xs: 12, sm: 6 }}>{field('proposed_end', 'Proposed end', { props: { type: 'date', required: true, slotProps: { inputLabel: { shrink: true } } } })}</Grid>
            <Grid size={{ xs: 12, sm: 6 }}>{field('proposed_budget', 'Proposed budget', { props: { type: 'number',
              slotProps: { input: { startAdornment: <InputAdornment position="start">$</InputAdornment> } } } })}</Grid>
            <Grid size={12}>{field('reason', 'Reason', { helper: 'Why is this project needed now?', props: { required: true, multiline: true, minRows: 2 } })}</Grid>
          </Grid>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose} disabled={isSubmitting}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={isSubmitting}>{isSubmitting ? 'Sending…' : 'Submit request'}</Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

function RejectDialog({ request, onClose }) {
  const titleId = useId()
  const reject = useRejectRequest()
  const [comment, setComment] = useState('')
  const [error, setError] = useState('')
  const [failure, setFailure] = useState(null)
  const confirm = async () => {
    if (!comment.trim()) { setError('Add a comment for the requester'); return }
    setFailure(null)
    try { await reject.mutateAsync({ id: request.id, comment: comment.trim() }); onClose() } catch (err) { setFailure(err) }
  }
  return (
    <Dialog open onClose={reject.isPending ? undefined : onClose} aria-labelledby={titleId} maxWidth="xs" fullWidth>
      <DialogTitle id={titleId}>Reject this request?</DialogTitle>
      <DialogContent>
        <Stack sx={{ gap: 2, pt: 1 }}>
          <Typography variant="body2">{request.requested_by.name} will see your comment on "{request.name}".</Typography>
          <ErrorAlert error={failure} />
          <TextField label="Comment" required multiline minRows={2} value={comment} autoFocus
            onChange={(e) => { setComment(e.target.value); setError('') }} error={Boolean(error)} helperText={error} />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={reject.isPending}>Cancel</Button>
        <Button color="error" variant="contained" onClick={confirm} disabled={reject.isPending}>Reject</Button>
      </DialogActions>
    </Dialog>
  )
}

function RequestCard({ request, decide, onReject }) {
  const navigate = useNavigate()
  const approve = useApproveRequest()
  const [failure, setFailure] = useState(null)
  return (
    <Card data-request={request.id}>
      <CardContent>
        <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 1, mb: 1 }}>
          <Typography variant="subtitle1" component="h2">{request.name}</Typography>
          <StatusChip status={request.status === 'pending' ? 'pending' : request.status}
            label={request.status === 'pending' ? 'Waiting for an admin' : undefined} />
        </Stack>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          <PersonLink person={request.requested_by} /> · {formatDate(request.proposed_start)} – {formatDate(request.proposed_end)} · {formatMoney(request.proposed_budget)}
        </Typography>
        <Typography variant="body2" sx={{ mt: 1 }}>{request.reason}</Typography>
        {request.decision_comment ? <Typography variant="body2" sx={{ mt: 1, fontStyle: 'italic' }}>Admin: {request.decision_comment}</Typography> : null}
        <ErrorAlert error={failure} sx={{ mt: 1 }} />
      </CardContent>
      {decide && request.status === 'pending' ? (
        <CardActions sx={{ px: 2, pb: 2 }}>
          <Button variant="contained" disabled={approve.isPending} onClick={async () => {
            setFailure(null)
            try {
              const result = await approve.mutateAsync(request.id)
              navigate(`/projects/${result.project.id}`)
            } catch (err) { setFailure(err) }
          }}>Approve</Button>
          <Button color="error" onClick={() => onReject(request)}>Reject</Button>
        </CardActions>
      ) : null}
    </Card>
  )
}

export default function RequestsPage() {
  const { user } = useSession()
  const decide = can(user, 'request.decide')
  const [status, setStatus] = useState(decide ? 'pending' : null)
  const requests = useRequests(status)
  const [creating, setCreating] = useState(false)
  const [rejecting, setRejecting] = useState(null)
  const leaving = useRedirectOnDenied(requests.error)
  const items = requests.data ?? []
  if (leaving) return null

  return (
    <>
      <PageHeader title="Project requests"
        subtitle={decide ? 'Managers propose projects here. Approving one creates it with that manager in charge.'
          : 'Propose a new project. An admin approves it or replies with a comment.'}
        actions={can(user, 'request.submit') ? <Button variant="contained" startIcon={<Add />} onClick={() => setCreating(true)}>Request a project</Button> : null} />
      {decide ? (
        <Tabs value={status} onChange={(_, v) => setStatus(v)} sx={{ mb: 2 }} aria-label="Request status">
          <Tab value="pending" label="Pending" /><Tab value="approved" label="Approved" /><Tab value="rejected" label="Rejected" />
        </Tabs>
      ) : null}
      <ErrorAlert error={requests.error} onRetry={() => requests.refetch()} sx={{ mb: 2 }} />
      {!requests.isLoading && items.length === 0 ? (
        <EmptyState title={decide ? 'Nothing here' : "You haven't requested any projects yet"}
          description={decide ? 'New requests from managers show up under Pending.' : 'Use “Request a project” to propose one.'} />
      ) : (
        <Stack sx={{ gap: 2 }}>
          {items.map((r) => <RequestCard key={r.id} request={r} decide={decide} onReject={setRejecting} />)}
        </Stack>
      )}
      {creating ? <RequestForm onClose={() => setCreating(false)} /> : null}
      {rejecting ? <RejectDialog request={rejecting} onClose={() => setRejecting(null)} /> : null}
    </>
  )
}
