import PersonAdd from '@mui/icons-material/PersonAddAlt'
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, List, ListItem, ListItemAvatar, ListItemText,
  MenuItem,
  Paper, Stack, TextField, Tooltip,
} from '@mui/material'
import Delete from '@mui/icons-material/DeleteOutlined'
import EditIcon from '@mui/icons-material/EditOutlined'
import { zodResolver } from '@hookform/resolvers/zod'
import { useId, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useAddMember, useMembers, usePeoplePicker, useRemoveMember, useUpdateMember } from '../../api/queries.js'
import SkillChips from '../../components/SkillChips.jsx'
import ConfirmDialog from '../../components/ConfirmDialog.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import UserAvatar from '../../components/UserAvatar.jsx'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import PersonLink from '../../components/PersonLink.jsx'
import { formatHours, fullName } from '../../lib/format.js'
import { memberSchema } from '../../lib/schemas.js'
import { AVATAR_SIZE } from '../../lib/avatarLook.js'
import MessageButton from '../messages/MessageButton.jsx'

function capMessage(name, err) {
  return `${name} is already planned for ${err.details.current_total}h of ${err.details.cap}h per week.`
}

function MemberDialog({ projectId, member, people, onClose }) {
  const titleId = useId()
  const add = useAddMember(projectId)
  const update = useUpdateMember(projectId)
  const [failure, setFailure] = useState(null)
  const { control, register, handleSubmit, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(memberSchema),
    defaultValues: { user_id: member ? String(member.user.id) : '', planned_hours_per_week: member?.planned_hours_per_week ?? 10 },
  })
  const nameOf = (id) => fullName(people.find((p) => String(p.id) === String(id)) ?? member?.user)

  const onSubmit = async (values) => {
    setFailure(null)
    try {
      if (member) await update.mutateAsync({ userId: member.user.id, hours: values.planned_hours_per_week })
      else await add.mutateAsync({ user_id: values.user_id, planned_hours_per_week: values.planned_hours_per_week })
      onClose()
    } catch (err) {
      setFailure(err.code === 'PLANNED_HOURS_EXCEEDED' ? { capped: capMessage(nameOf(values.user_id), err) } : err)
    }
  }

  return (
    <Dialog open onClose={isSubmitting ? undefined : onClose} aria-labelledby={titleId} maxWidth="xs" fullWidth>
      <form noValidate onSubmit={handleSubmit(onSubmit)}>
        <DialogTitle id={titleId}>{member ? `Planned hours for ${fullName(member.user)}` : 'Add a team member'}</DialogTitle>
        <DialogContent>
          <Stack sx={{ gap: 2, pt: 1 }}>
            {failure?.capped ? <Alert severity="error" role="alert">{failure.capped}</Alert> : <ErrorAlert error={failure} />}
            {member ? null : (
              <Controller name="user_id" control={control} render={({ field }) => (
                <TextField select label="Person" required {...field} error={Boolean(errors.user_id)}
                  helperText={errors.user_id?.message} disabled={isSubmitting}>
                  {people.map((p) => <MenuItem key={p.id} value={String(p.id)}>{`${fullName(p)} — ${p.job_title || 'No title'}`}</MenuItem>)}
                </TextField>
              )} />
            )}
            <TextField label="Planned hours per week" type="number" required {...register('planned_hours_per_week')}
              slotProps={{ htmlInput: { min: 0.5, max: 40, step: 0.5 } }} error={Boolean(errors.planned_hours_per_week)}
              helperText={errors.planned_hours_per_week?.message ?? 'Across all projects a person can be planned for at most 40h a week.'}
              disabled={isSubmitting} />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose} disabled={isSubmitting}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={isSubmitting}>{member ? 'Save' : 'Add'}</Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

export default function TeamTab({ project, manage }) {
  const members = useMembers(project.id)
  const people = usePeoplePicker(manage)
  const remove = useRemoveMember(project.id)
  const [dialog, setDialog] = useState(null)
  const [removing, setRemoving] = useState(null)
  const current = new Set((members.data ?? []).map((m) => String(m.user.id)))
  const available = (people.data ?? []).filter((p) => !current.has(String(p.id)))

  return (
    <Stack sx={{ gap: 2 }}>
      {manage ? (
        <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
          <Button variant="contained" startIcon={<PersonAdd />} onClick={() => setDialog({ member: null })}>Add member</Button>
        </Stack>
      ) : null}
      <ErrorAlert error={members.error} onRetry={() => members.refetch()} />
      {members.data?.length === 0 ? (
        <EmptyState title="Nobody on this project yet" description={manage ? 'Add people and plan their weekly hours.' : undefined} />
      ) : (
        <Paper variant="outlined">
          <List aria-label="Team members" disablePadding>
            {(members.data ?? []).map((m) => (
              <ListItem key={m.user.id} divider secondaryAction={manage ? (
                <Stack direction="row">
                  <MessageButton person={{ id: m.user.id, name: fullName(m.user) }} variant="icon" />
                  <Tooltip title="Change planned hours"><IconButton aria-label={`Change hours for ${fullName(m.user)}`}
                    onClick={() => setDialog({ member: m })}><EditIcon /></IconButton></Tooltip>
                  <Tooltip title="Remove from project"><IconButton aria-label={`Remove ${fullName(m.user)}`}
                    onClick={() => setRemoving(m)}><Delete /></IconButton></Tooltip>
                </Stack>
              ) : <MessageButton person={{ id: m.user.id, name: fullName(m.user) }} variant="icon" />}>
                <ListItemAvatar sx={{ minWidth: 52 }}><UserAvatar userId={m.user.id} name={fullName(m.user)} size={AVATAR_SIZE.row} /></ListItemAvatar>
                <ListItemText primary={<PersonLink person={{ id: m.user.id, name: fullName(m.user) }} context={{ project }} />}
                  secondary={<>
                    {`${m.user.job_title || 'No title'} · ${formatHours(m.planned_hours_per_week)} planned per week`}
                    <SkillChips skills={m.user.skills ?? []} label={`Skills of ${fullName(m.user)}`} sx={{ mt: 0.5 }} />
                  </>}
                  slotProps={{ secondary: { component: 'div' } }} />
              </ListItem>
            ))}
          </List>
        </Paper>
      )}
      {dialog ? <MemberDialog projectId={project.id} member={dialog.member} people={available} onClose={() => setDialog(null)} /> : null}
      <ConfirmDialog open={Boolean(removing)} title="Remove from project?" confirmLabel="Remove" busy={remove.isPending}
        body={removing ? `${fullName(removing.user)} will also be unassigned from this project's milestones. Logged hours stay on record.` : ''}
        onClose={() => setRemoving(null)}
        onConfirm={async () => { await remove.mutateAsync(removing.user.id); setRemoving(null) }} />
    </Stack>
  )
}
