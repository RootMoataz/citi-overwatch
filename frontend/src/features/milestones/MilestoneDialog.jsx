import { zodResolver } from '@hookform/resolvers/zod'
import {
  Alert, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, Grid, ListItemText, MenuItem, TextField,
} from '@mui/material'
import { useId, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useMediaQuery } from 'react-responsive'
import { useSaveMilestone } from '../../api/queries.js'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import { formatDate, fullName } from '../../lib/format.js'
import { DESKTOP_QUERY } from '../../lib/responsive.js'
import { milestoneSchema } from '../../lib/schemas.js'

const FORM_CODES = ['OUT_OF_PROJECT_RANGE']
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x))

/** Create or edit a milestone, its dependencies and its assignees. */
export default function MilestoneDialog({ project, milestone, milestones, members, onClose, onWarning }) {
  const titleId = useId()
  const desktop = useMediaQuery(DESKTOP_QUERY)
  const save = useSaveMilestone(project.id)
  const [failure, setFailure] = useState(null)
  const initialPreds = (milestone?.predecessors ?? []).map(String)
  const initialPeople = (milestone?.assignees ?? []).map((a) => String(a.id))
  const { register, control, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(milestoneSchema),
    defaultValues: {
      name: milestone?.name ?? '', description: milestone?.description ?? '', start_date: milestone?.start_date ?? '',
      end_date: milestone?.end_date ?? '', predecessor_ids: initialPreds, assignee_ids: initialPeople,
    },
  })
  const others = milestones.filter((m) => String(m.id) !== String(milestone?.id))
  const nameOf = (id) => others.find((m) => String(m.id) === id)?.name ?? id
  const personOf = (id) => fullName(members.find((m) => String(m.user.id) === id)?.user) || id

  const onSubmit = async (values) => {
    setFailure(null)
    const fields = {}
    for (const key of ['name', 'description', 'start_date', 'end_date']) {
      if (!milestone || values[key] !== (milestone[key] ?? '')) fields[key] = values[key]
    }
    try {
      const saved = await save.mutateAsync({
        id: milestone?.id, fields,
        predecessorIds: sameSet(values.predecessor_ids, initialPreds) && milestone ? null : values.predecessor_ids,
        assigneeIds: sameSet(values.assignee_ids, initialPeople) && milestone ? null : values.assignee_ids,
      })
      if (saved.warnings?.includes('STARTS_BEFORE_PREDECESSOR_ENDS')) {
        onWarning?.(`${values.name} starts before one of the milestones it depends on ends.`)
      }
      onClose()
    } catch (err) {
      if (err.code === 'DEPENDENCY_CYCLE') setError('predecessor_ids', { message: 'That dependency would create a loop.' })
      else if (err.code === 'CROSS_PROJECT_DEPENDENCY') setError('predecessor_ids', { message: 'Pick milestones from this project only.' })
      else if (err.code === 'NOT_A_MEMBER') setError('assignee_ids', { message: 'Add these people to the project team first.' })
      else setFailure(err)
    }
  }

  const multi = (name, label, options, render, helper) => (
    <Controller name={name} control={control} render={({ field }) => (
      <TextField select label={label} {...field} error={Boolean(errors[name])} disabled={isSubmitting}
        helperText={errors[name]?.message ?? helper}
        slotProps={{ select: { multiple: true, renderValue: (ids) => ids.map(render).join(', ') } }}>
        {options.map((o) => (
          <MenuItem key={o.value} value={o.value}>
            <Checkbox checked={field.value.includes(o.value)} size="small" />
            <ListItemText primary={o.label} secondary={o.secondary} />
          </MenuItem>
        ))}
        {options.length === 0 ? <MenuItem disabled value="">Nothing to pick yet</MenuItem> : null}
      </TextField>
    )} />
  )

  return (
    <Dialog open onClose={isSubmitting ? undefined : onClose} aria-labelledby={titleId} fullScreen={!desktop} maxWidth="sm" fullWidth>
      <form noValidate onSubmit={handleSubmit(onSubmit)}>
        <DialogTitle id={titleId}>{milestone ? 'Edit milestone' : 'New milestone'}</DialogTitle>
        <DialogContent>
          {failure ? (FORM_CODES.includes(failure.code)
            ? <Alert severity="error" role="alert" sx={{ mb: 2 }}>{failure.message}</Alert>
            : <ErrorAlert error={failure} sx={{ mb: 2 }} />) : null}
          <Grid container spacing={2} sx={{ pt: 1 }}>
            <Grid size={12}>
              <TextField label="Name" required autoFocus {...register('name')} error={Boolean(errors.name)}
                helperText={errors.name?.message} disabled={isSubmitting} />
            </Grid>
            <Grid size={12}>
              <TextField label="Description" multiline minRows={2} {...register('description')} disabled={isSubmitting}
                helperText="The goal, e.g. “Decommission 200 servers”." />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField label="Start date" type="date" required {...register('start_date')} disabled={isSubmitting}
                slotProps={{ inputLabel: { shrink: true } }} error={Boolean(errors.start_date)}
                helperText={errors.start_date?.message ?? `From ${formatDate(project.start_date)}`} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField label="End date" type="date" required {...register('end_date')} disabled={isSubmitting}
                slotProps={{ inputLabel: { shrink: true } }} error={Boolean(errors.end_date)}
                helperText={errors.end_date?.message ?? `Until ${formatDate(project.predicted_end_date)}`} />
            </Grid>
            <Grid size={12}>
              {multi('predecessor_ids', 'Depends on', others.map((m) => ({ value: String(m.id), label: m.name,
                secondary: `${formatDate(m.start_date)} – ${formatDate(m.end_date)}` })), nameOf,
              'This milestone stays blocked until these are completed.')}
            </Grid>
            <Grid size={12}>
              {multi('assignee_ids', 'Assigned to', members.map((m) => ({ value: String(m.user.id), label: fullName(m.user),
                secondary: m.user.job_title })), personOf, 'Assigned people can update status and log hours here.')}
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose} disabled={isSubmitting}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={isSubmitting}>{isSubmitting ? 'Saving…' : 'Save'}</Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
