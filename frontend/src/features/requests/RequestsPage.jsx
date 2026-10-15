import Add from '@mui/icons-material/Add'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  Button, Card, CardActions, CardContent, Dialog, DialogActions, DialogContent, DialogTitle, Grid, InputAdornment, MenuItem,
  Stack, Tab, Tabs, TextField, Typography,
} from '@mui/material'
import { useId, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useMediaQuery } from 'react-responsive'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useApproveRequest, useDepartments, useRejectRequest, useRequests, useSubmitRequest } from '../../api/queries.js'
import { useSession } from '../../auth/sessionContext.js'
import ConfirmDialog from '../../components/ConfirmDialog.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import { useRedirectOnDenied } from '../../app/access.js'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import PageHeader from '../../components/PageHeader.jsx'
import PersonLink from '../../components/PersonLink.jsx'
import StatusChip from '../../components/StatusChip.jsx'
import { formatDate, formatMoney } from '../../lib/format.js'
import { WORK_MODE } from '../../lib/labels.js'
import { can } from '../../lib/permissions.js'
import { DESKTOP_QUERY } from '../../lib/responsive.js'
import { requestSchema } from '../../lib/schemas.js'

const NOTE_MAX = 500 // the optional note on a rejection (the server's limit)

/** A request holds only what the project starts with: no reason to justify it (the admin decides on the plan). */
function RequestForm({ onClose }) {
  const titleId = useId()
  const desktop = useMediaQuery(DESKTOP_QUERY)
  const submit = useSubmitRequest()
  const departments = useDepartments()
  const [failure, setFailure] = useState(null)
  const { register, control, handleSubmit, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(requestSchema),
    defaultValues: { name: '', description: '', proposed_start: '', proposed_end: '', proposed_budget: '', department_id: '',
      work_mode: 'push' },
  })
  const field = (name, label, extra = {}) => (
    <TextField label={label} {...register(name)} error={Boolean(errors[name])} helperText={errors[name]?.message ?? extra.helper}
      disabled={isSubmitting} {...extra.props} />
  )
  return (
    <Dialog open onClose={isSubmitting ? undefined : onClose} aria-labelledby={titleId} fullScreen={!desktop} maxWidth="sm" fullWidth>
      <form noValidate onSubmit={handleSubmit(async (values) => {
        setFailure(null)
        try { await submit.mutateAsync({ ...values, department_id: values.department_id || null }); onClose() } catch (err) { setFailure(err) }
      })}>
        <DialogTitle id={titleId}>Request a project</DialogTitle>
        <DialogContent>
          <ErrorAlert error={failure} sx={{ mb: 2 }} />
          <Grid container spacing={2} sx={{ pt: 1 }}>
            <Grid size={12}>{field('name', 'Name', { props: { required: true, autoFocus: true } })}</Grid>
            <Grid size={12}>{field('description', 'Description', { helper: 'What the project delivers', props: { multiline: true, minRows: 2 } })}</Grid>
            <Grid size={{ xs: 12, sm: 6 }}>{field('proposed_start', 'Proposed start', { props: { type: 'date', required: true, slotProps: { inputLabel: { shrink: true } } } })}</Grid>
            <Grid size={{ xs: 12, sm: 6 }}>{field('proposed_end', 'Proposed end', { props: { type: 'date', required: true, slotProps: { inputLabel: { shrink: true } } } })}</Grid>
            <Grid size={{ xs: 12, sm: 6 }}>{field('proposed_budget', 'Proposed budget', { props: { type: 'number',
              slotProps: { input: { startAdornment: <InputAdornment position="start">$</InputAdornment> } } } })}</Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <Controller name="department_id" control={control} render={({ field: f }) => (
                <TextField select label="Department" {...f} disabled={isSubmitting}>
                  <MenuItem value="">No department</MenuItem>
                  {(departments.data?.items ?? []).map((d) => <MenuItem key={d.id} value={String(d.id)}>{d.name}</MenuItem>)}
                </TextField>
              )} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <Controller name="work_mode" control={control} render={({ field: f }) => (
                <TextField select label="Work mode" {...f} disabled={isSubmitting} helperText={WORK_MODE[f.value]?.help}>
                  {Object.entries(WORK_MODE).map(([mode, meta]) => <MenuItem key={mode} value={mode}>{meta.label}</MenuItem>)}
                </TextField>
              )} />
            </Grid>
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

/** Rejecting closes the request; a short note for the requester is optional. */
function RejectDialog({ request, onClose }) {
  const titleId = useId()
  const reject = useRejectRequest()
  const [note, setNote] = useState('')
  const [failure, setFailure] = useState(null)
  const confirm = async () => {
    setFailure(null)
    try { await reject.mutateAsync({ id: request.id, comment: note.trim() || undefined }); onClose() } catch (err) { setFailure(err) }
  }
  return (
    <Dialog open onClose={reject.isPending ? undefined : onClose} aria-labelledby={titleId} maxWidth="xs" fullWidth>
      <DialogTitle id={titleId}>Reject this request?</DialogTitle>
      <DialogContent>
        <Stack sx={{ gap: 2, pt: 1 }}>
          <Typography variant="body2">"{request.name}" closes and {request.requested_by.name} sees it as rejected.</Typography>
          <ErrorAlert error={failure} />
          <TextField label="Note (optional)" multiline minRows={2} value={note} autoFocus
            slotProps={{ htmlInput: { maxLength: NOTE_MAX } }} helperText={`Shown to ${request.requested_by.name}`}
            onChange={(e) => setNote(e.target.value)} />
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
  const [confirming, setConfirming] = useState(false)
  const [failure, setFailure] = useState(null)
  const mode = WORK_MODE[request.work_mode ?? 'push']
  const approveNow = async () => {
    setFailure(null)
    try {
      const result = await approve.mutateAsync(request.id)
      navigate(`/projects/${result.project.id}`)
    } catch (err) { setFailure(err); setConfirming(false) }
  }
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
          {' · '}{request.department?.name ?? 'No department'} · {mode.label} mode
        </Typography>
        {request.description ? <Typography variant="body2" sx={{ mt: 1 }}>{request.description}</Typography> : null}
        {request.decision_comment ? <Typography variant="body2" sx={{ mt: 1, fontStyle: 'italic' }}>Admin: {request.decision_comment}</Typography> : null}
        <ErrorAlert error={failure} sx={{ mt: 1 }} />
      </CardContent>
      {decide && request.status === 'pending' ? (
        <CardActions sx={{ px: 2, pb: 2 }}>
          <Button variant="contained" disabled={approve.isPending} onClick={() => setConfirming(true)}>Approve &amp; create project</Button>
          <Button color="error" onClick={() => onReject(request)}>Reject</Button>
        </CardActions>
      ) : null}
      <ConfirmDialog open={confirming} title={`Create ${request.name}?`} destructive={false} busy={approve.isPending}
        body={`It starts as a planned project with ${request.requested_by.name} as its manager.`}
        confirmLabel="Approve & create project" onConfirm={approveNow} onClose={() => setConfirming(false)} />
    </Card>
  )
}

export default function RequestsPage() {
  const { user } = useSession()
  const decide = can(user, 'request.decide')
  const [status, setStatus] = useState(decide ? 'pending' : null)
  const requests = useRequests(status)
  const [creating, setCreating] = useState(false)
  // ?new=1 (the command palette's "new project") opens the request form straight away.
  const [params, setParams] = useSearchParams()
  const fromUrl = params.get('new') === '1' && can(user, 'request.submit')
  const [rejecting, setRejecting] = useState(null)
  const leaving = useRedirectOnDenied(requests.error)
  const items = requests.data ?? []
  if (leaving) return null

  return (
    <>
      <PageHeader title="Project requests"
        subtitle={decide ? 'Managers propose projects here. Approving one creates it with that manager in charge.'
          : 'Propose a new project. An admin approves it (creating the project) or rejects it.'}
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
      {creating || fromUrl ? <RequestForm onClose={() => { setCreating(false); if (fromUrl) setParams({}, { replace: true }) }} /> : null}
      {rejecting ? <RejectDialog request={rejecting} onClose={() => setRejecting(null)} /> : null}
    </>
  )
}
