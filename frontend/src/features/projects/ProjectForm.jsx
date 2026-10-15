import { zodResolver } from '@hookform/resolvers/zod'
import {
  Alert, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, FormHelperText, Grid,
  InputAdornment, MenuItem, TextField,
} from '@mui/material'
import { useId, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { useMediaQuery } from 'react-responsive'
import { useDepartments, useManagers, useProjectTemplates } from '../../api/queries.js'
import { useSession } from '../../auth/sessionContext.js'
import { STATUS } from '../../app/theme.js'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import { fullName } from '../../lib/format.js'
import { WORK_MODE } from '../../lib/labels.js'
import { DESKTOP_QUERY } from '../../lib/responsive.js'
import { projectSchema } from '../../lib/schemas.js'

const NEXT_STATUS = {
  planned: ['planned', 'active'], active: ['active', 'on_hold', 'completed'],
  on_hold: ['on_hold', 'active', 'completed'], completed: ['completed'],
}
const FIELD_MESSAGES = {
  name: { taken: 'A project with this name already exists' },
  delegate_approver_id: { invalid: 'Pick an active manager or admin other than the project manager' },
  delegate_until: { past: "The delegation can't end in the past", no_delegate: 'Pick a delegate approver first' },
}
const FORM_CODES = ['MILESTONES_OUT_OF_RANGE', 'MILESTONES_INCOMPLETE', 'INVALID_TRANSITION']

/** Create (admin) or edit (manager/admin) a project. Editing also sets the delegate approver: another active manager
 * or admin who may approve the project's hours, optionally until a date. A new project in a department with a
 * template can start from it (on by default): the server adds the department's milestone plan in the same step. */
export default function ProjectForm({ open, project, onClose, onSave }) {
  const { user } = useSession()
  const desktop = useMediaQuery(DESKTOP_QUERY)
  const titleId = useId()
  const editing = Boolean(project)
  const admin = user?.role === 'admin'
  const managers = useManagers(open && (admin || editing))
  const departments = useDepartments({ enabled: open })
  // An archived department isn't offered any more, but a project already in one still shows it.
  const departmentOptions = [...(departments.data?.items ?? [])]
  if (project?.department && !departmentOptions.some((d) => String(d.id) === String(project.department.id))) {
    departmentOptions.push(project.department)
  }
  const templates = useProjectTemplates({ enabled: open && !editing })
  const [useTemplate, setUseTemplate] = useState(true)
  const [failure, setFailure] = useState(null)
  const { register, control, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(projectSchema),
    defaultValues: {
      name: project?.name ?? '', description: project?.description ?? '', start_date: project?.start_date ?? '',
      predicted_end_date: project?.predicted_end_date ?? '', budget: project?.budget ?? '',
      manager_id: project ? String(project.manager.id) : '', status: project?.status ?? 'planned',
      department_id: project?.department ? String(project.department.id) : '', work_mode: project?.work_mode ?? 'push',
      delegate_approver_id: project?.delegate ? String(project.delegate.id) : '', delegate_until: project?.delegate?.until ?? '',
    },
  })
  const [managerId, delegateId, departmentId] = useWatch({ control, name: ['manager_id', 'delegate_approver_id', 'department_id'] })
  const departmentName = departmentOptions.find((d) => String(d.id) === String(departmentId))?.name
  const template = !editing && departmentName
    ? (templates.data?.items ?? []).find((t) => t.department.toLowerCase() === departmentName.trim().toLowerCase())
    : null
  // Anyone who can approve except the project's own manager (they approve anyway).
  const delegateOptions = (managers.data ?? []).filter((m) => String(m.id) !== String(managerId))
  if (project?.delegate && !delegateOptions.some((m) => String(m.id) === String(project.delegate.id))) {
    const [first_name, ...rest] = project.delegate.name.split(' ')
    delegateOptions.push({ id: project.delegate.id, first_name, last_name: rest.join(' ') })
  }

  const onSubmit = async (values) => {
    setFailure(null)
    const body = { name: values.name, description: values.description ?? '', start_date: values.start_date,
      predicted_end_date: values.predicted_end_date, budget: values.budget,
      department_id: values.department_id || null, work_mode: values.work_mode }
    if (admin) body.manager_id = values.manager_id
    if (editing && values.status !== project.status) body.status = values.status
    if (editing) {
      // Sent only when changed, so saving other fields never re-checks an end date that has since passed.
      const before = { id: project.delegate ? String(project.delegate.id) : '', until: project.delegate?.until ?? '' }
      if (values.delegate_approver_id !== before.id || (values.delegate_approver_id && values.delegate_until !== before.until)) {
        body.delegate_approver_id = values.delegate_approver_id || null
        if (values.delegate_approver_id) body.delegate_until = values.delegate_until || null
      }
    }
    if (!editing) body.status = 'planned'
    if (template && useTemplate) body.template = true
    try {
      await onSave(body)
    } catch (err) {
      const fields = err.details && typeof err.details === 'object' ? Object.entries(err.details) : []
      const mapped = fields.filter(([field]) => field in values)
      if (mapped.length && !FORM_CODES.includes(err.code)) {
        for (const [field, reason] of mapped) {
          setError(field, { message: FIELD_MESSAGES[field]?.[reason] ?? err.message })
        }
      } else {
        setFailure(err)
      }
    }
  }

  const statusOptions = editing ? NEXT_STATUS[project.status] : []
  return (
    <Dialog open={open} onClose={isSubmitting ? undefined : onClose} fullScreen={!desktop} maxWidth="sm" fullWidth
      aria-labelledby={titleId}>
      <form noValidate onSubmit={handleSubmit(onSubmit)}>
        <DialogTitle id={titleId}>{editing ? 'Edit project' : 'New project'}</DialogTitle>
        <DialogContent>
          {failure ? (FORM_CODES.includes(failure.code)
            ? <Alert severity="error" role="alert" sx={{ mb: 2 }}>{failure.message}</Alert>
            : <ErrorAlert error={failure} sx={{ mb: 2 }} />) : null}
          <Grid container spacing={2} sx={{ pt: 1 }}>
            <Grid size={12}>
              <TextField label="Name" required {...register('name')} error={Boolean(errors.name)}
                helperText={errors.name?.message} disabled={isSubmitting} autoFocus />
            </Grid>
            <Grid size={12}>
              <TextField label="Description" multiline minRows={2} {...register('description')} disabled={isSubmitting} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField label="Start date" type="date" required {...register('start_date')}
                slotProps={{ inputLabel: { shrink: true } }} error={Boolean(errors.start_date)}
                helperText={errors.start_date?.message} disabled={isSubmitting} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField label="Predicted end date" type="date" required {...register('predicted_end_date')}
                slotProps={{ inputLabel: { shrink: true } }} error={Boolean(errors.predicted_end_date)}
                helperText={errors.predicted_end_date?.message} disabled={isSubmitting} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField label="Budget" type="number" {...register('budget')} error={Boolean(errors.budget)}
                helperText={errors.budget?.message ?? 'Planned spend for the whole project'} disabled={isSubmitting}
                slotProps={{ input: { startAdornment: <InputAdornment position="start">$</InputAdornment> },
                  htmlInput: { min: 0, step: 100 } }} />
            </Grid>
            {admin ? (
              <Grid size={{ xs: 12, sm: 6 }}>
                <Controller name="manager_id" control={control} render={({ field }) => (
                  <TextField select label="Manager" required {...field} error={Boolean(errors.manager_id)}
                    helperText={errors.manager_id?.message ?? 'One manager owns the project'} disabled={isSubmitting}>
                    {(managers.data ?? []).map((m) => (
                      <MenuItem key={m.id} value={String(m.id)}>{fullName(m)}</MenuItem>
                    ))}
                    {managers.isLoading ? <MenuItem disabled value="">Loading…</MenuItem> : null}
                  </TextField>
                )} />
              </Grid>
            ) : null}
            <Grid size={{ xs: 12, sm: 6 }}>
              <Controller name="department_id" control={control} render={({ field }) => (
                <TextField select label="Department" {...field} disabled={isSubmitting}
                  helperText="Used to filter the dashboard">
                  <MenuItem value="">No department</MenuItem>
                  {departmentOptions.map((d) => <MenuItem key={d.id} value={String(d.id)}>{d.name}</MenuItem>)}
                </TextField>
              )} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <Controller name="work_mode" control={control} render={({ field }) => (
                <TextField select label="Work mode" {...field} disabled={isSubmitting}
                  helperText={WORK_MODE[field.value]?.help}>
                  {Object.entries(WORK_MODE).map(([mode, meta]) => <MenuItem key={mode} value={mode}>{meta.label}</MenuItem>)}
                </TextField>
              )} />
            </Grid>
            {template ? (
              <Grid size={12}>
                <FormControlLabel label={`Start from the ${template.department} template`} control={
                  <Checkbox checked={useTemplate} onChange={(e) => setUseTemplate(e.target.checked)} disabled={isSubmitting} />} />
                <FormHelperText sx={{ mt: 0 }}>
                  Adds {template.milestones.length} milestones across the project dates, not started and unassigned:{' '}
                  {template.milestones.map((m) => m.name).join(', ')}.
                </FormHelperText>
              </Grid>
            ) : null}
            {editing ? (
              <>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <Controller name="delegate_approver_id" control={control} render={({ field }) => (
                    <TextField select label="Delegate approver" {...field} disabled={isSubmitting}
                      error={Boolean(errors.delegate_approver_id)}
                      helperText={errors.delegate_approver_id?.message ?? 'Can approve this project\'s hours, e.g. while you\'re away'}>
                      <MenuItem value="">No delegate</MenuItem>
                      {delegateOptions.map((m) => <MenuItem key={m.id} value={String(m.id)}>{fullName(m)}</MenuItem>)}
                    </TextField>
                  )} />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField label="Delegate until" type="date" {...register('delegate_until')}
                    slotProps={{ inputLabel: { shrink: true } }} disabled={isSubmitting || !delegateId}
                    error={Boolean(errors.delegate_until)}
                    helperText={errors.delegate_until?.message ?? 'Optional; empty means until you remove it'} />
                </Grid>
              </>
            ) : null}
            {editing ? (
              <Grid size={{ xs: 12, sm: 6 }}>
                <Controller name="status" control={control} render={({ field }) => (
                  <TextField select label="Status" {...field} disabled={isSubmitting}
                    helperText={project.status === 'completed' ? 'Completed projects stay completed' : 'Completing needs every milestone done'}>
                    {statusOptions.map((s) => <MenuItem key={s} value={s}>{STATUS[s].label}</MenuItem>)}
                  </TextField>
                )} />
              </Grid>
            ) : null}
          </Grid>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose} disabled={isSubmitting}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : editing ? 'Save changes' : 'Create project'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
