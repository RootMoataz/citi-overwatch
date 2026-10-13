import { zodResolver } from '@hookform/resolvers/zod'
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Grid, InputAdornment, MenuItem, TextField,
} from '@mui/material'
import { useId, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useMediaQuery } from 'react-responsive'
import { useManagers } from '../../api/queries.js'
import { useSession } from '../../auth/sessionContext.js'
import { STATUS } from '../../app/theme.js'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import { fullName } from '../../lib/format.js'
import { DESKTOP_QUERY } from '../../lib/responsive.js'
import { projectSchema } from '../../lib/schemas.js'

const NEXT_STATUS = {
  planned: ['planned', 'active'], active: ['active', 'on_hold', 'completed'],
  on_hold: ['on_hold', 'active', 'completed'], completed: ['completed'],
}
const FIELD_MESSAGES = { name: { taken: 'A project with this name already exists' } }
const FORM_CODES = ['MILESTONES_OUT_OF_RANGE', 'MILESTONES_INCOMPLETE', 'INVALID_TRANSITION']

/** Create (admin) or edit (manager/admin) a project. */
export default function ProjectForm({ open, project, onClose, onSave }) {
  const { user } = useSession()
  const desktop = useMediaQuery(DESKTOP_QUERY)
  const titleId = useId()
  const editing = Boolean(project)
  const admin = user?.role === 'admin'
  const managers = useManagers(open && admin)
  const [failure, setFailure] = useState(null)
  const { register, control, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(projectSchema),
    defaultValues: {
      name: project?.name ?? '', description: project?.description ?? '', start_date: project?.start_date ?? '',
      predicted_end_date: project?.predicted_end_date ?? '', budget: project?.budget ?? '',
      manager_id: project ? String(project.manager.id) : '', status: project?.status ?? 'planned',
    },
  })

  const onSubmit = async (values) => {
    setFailure(null)
    const body = { name: values.name, description: values.description ?? '', start_date: values.start_date,
      predicted_end_date: values.predicted_end_date, budget: values.budget }
    if (admin) body.manager_id = values.manager_id
    if (editing && values.status !== project.status) body.status = values.status
    if (!editing) body.status = 'planned'
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
