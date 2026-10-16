import PersonAdd from '@mui/icons-material/PersonAddAlt'
import MoreHoriz from '@mui/icons-material/MoreHoriz'
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Menu, MenuItem, Paper, Stack, TextField,
  Typography,
} from '@mui/material'
import { zodResolver } from '@hookform/resolvers/zod'
import { useId, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useAddMember, useMembers, usePeoplePicker, useRemoveMember, useUpdateMember } from '../../api/queries.js'
import SkillChips from '../../components/SkillChips.jsx'
import ConfirmDialog from '../../components/ConfirmDialog.jsx'
import DataTable from '../../components/DataTable.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import FilterBar from '../../components/FilterBar.jsx'
import FootNote from '../../components/FootNote.jsx'
import UserAvatar from '../../components/UserAvatar.jsx'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import PersonLink from '../../components/PersonLink.jsx'
import YouTag from '../../components/YouTag.jsx'
import { formatDate, formatHours, fullName, nyTodayIso } from '../../lib/format.js'
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

const nameOf = (m) => fullName(m.user)
const skillNames = (m) => (m.user.skills ?? []).map((s) => s.name)

/** A member's "⋯" (managers only): Edit planned hours, and Remove from project, which `onRemove` confirms. */
function MemberMenu({ member, onEdit, onRemove }) {
  const menuId = useId()
  const [anchor, setAnchor] = useState(null)
  const close = () => setAnchor(null)
  return (
    <>
      <IconButton aria-label={`More actions for ${nameOf(member)}`} aria-haspopup="menu" aria-expanded={anchor ? 'true' : undefined}
        aria-controls={anchor ? menuId : undefined} onClick={(e) => setAnchor(e.currentTarget)} sx={{ width: 44, height: 44 }}>
        <MoreHoriz />
      </IconButton>
      <Menu id={menuId} anchorEl={anchor} open={Boolean(anchor)} onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
        <MenuItem onClick={() => { close(); onEdit(member) }}>Edit planned hours</MenuItem>
        <MenuItem onClick={() => { close(); onRemove(member) }} sx={{ color: 'error.main' }}>Remove from project</MenuItem>
      </Menu>
    </>
  )
}

/**
 * The Team tab: a summary (people and planned hours a week, "Add member" for `view.manage`), a search, and the people
 * ordered by last name, each with Message (the server's contact list decides) and, for `view.manage`, a "⋯". Phones get cards.
 */
export default function TeamTab({ project, user, view }) {
  const manage = view.manage
  const members = useMembers(project.id)
  const people = usePeoplePicker(manage)
  const remove = useRemoveMember(project.id)
  const [dialog, setDialog] = useState(null)
  const [removing, setRemoving] = useState(null)
  const [search, setSearch] = useState('')
  const all = members.data ?? []
  const current = new Set(all.map((m) => String(m.user.id)))
  const available = (people.data ?? []).filter((p) => !current.has(String(p.id)))
  const planned = all.reduce((sum, m) => sum + Number(m.planned_hours_per_week ?? 0), 0)
  const needle = search.trim().toLowerCase()
  const shown = all.filter((m) => !needle
    || `${nameOf(m)}\n${m.user.job_title ?? ''}\n${skillNames(m).join('\n')}`.toLowerCase().includes(needle))
  const isMe = (m) => user?.id != null && String(m.user.id) === String(user.id)
  const person = (m) => ({ id: m.user.id, name: nameOf(m) })

  const addButton = manage ? (
    <Button variant="contained" startIcon={<PersonAdd />} onClick={() => setDialog({ member: null })} sx={{ minHeight: { xs: 44, md: 'auto' } }}>
      Add member
    </Button>
  ) : null
  const menuFor = manage ? (m) => <MemberMenu member={m} onEdit={(x) => setDialog({ member: x })} onRemove={setRemoving} /> : undefined

  const who = (m) => (
    <Stack direction="row" sx={{ alignItems: 'center', gap: 1.5, minWidth: 0 }}>
      <UserAvatar userId={m.user.id} name={nameOf(m)} size={AVATAR_SIZE.row} />
      <Box sx={{ minWidth: 0 }}>
        <Stack direction="row" useFlexGap sx={{ alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
          <Typography variant="body2" component="span" sx={{ fontWeight: 600 }}>
            <PersonLink person={person(m)} context={{ project }} />
          </Typography>
          {isMe(m) ? <YouTag /> : null}
        </Stack>
        <Typography variant="caption" component="div" sx={{ color: 'text.secondary' }}>{m.user.job_title || 'No title'}</Typography>
      </Box>
    </Stack>
  )
  const skills = (m) => <SkillChips skills={m.user.skills ?? []} label={`Skills of ${nameOf(m)}`} empty="—" />
  const message = (m) => <MessageButton person={person(m)} size="small" />

  const columns = [
    { key: 'person', header: 'Person', sortable: true, rowHeader: true, render: who,
      sortValue: (m) => `${m.user.last_name ?? ''} ${m.user.first_name ?? ''}`.trim() },
    { key: 'skills', header: 'Skills', render: skills },
    { key: 'planned', header: 'Planned / week', sortable: true, sortValue: (m) => Number(m.planned_hours_per_week),
      render: (m) => formatHours(m.planned_hours_per_week) },
    { key: 'actions', header: 'Actions', align: 'right', render: (m) => (
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'flex-end', gap: 0.5 }}>{message(m)}{menuFor?.(m)}</Stack>) },
  ]
  const renderCard = (m) => (
    <Stack sx={{ gap: 1 }}>
      {who(m)}
      {m.user.skills?.length ? skills(m) : null}
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>{`Planned / week: ${formatHours(m.planned_hours_per_week)}`}</Typography>
        {message(m)}
      </Stack>
    </Stack>
  )

  const empty = members.isSuccess && all.length === 0
  return (
    <Stack sx={{ gap: 2 }}>
      <Paper variant="outlined" sx={{ p: 2, minWidth: 0 }}>
        <Stack sx={{ flexDirection: { xs: 'column', sm: 'row' }, justifyContent: 'space-between', alignItems: { sm: 'center' }, gap: 1.5 }}>
          <Box>
            <Typography variant="h3" component="h2">{`${all.length} team ${all.length === 1 ? 'member' : 'members'}`}</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {`On this project · ${formatHours(planned)} planned per week`}
            </Typography>
          </Box>
          {addButton}
        </Stack>
        <ErrorAlert error={members.error} onRetry={() => members.refetch()} />
        {empty ? (
          <EmptyState title="Nobody on this project yet" description={manage ? 'Add people and plan their weekly hours.' : undefined} />
        ) : (
          <>
            <Box sx={{ mt: 2 }}>
              <FilterBar search={{ label: 'Search team members', placeholder: 'Search team members…', value: search, onChange: setSearch }} />
            </Box>
            <Box sx={{ mt: 2 }}>
              <DataTable ariaLabel="Team members" columns={columns} rows={shown} getRowId={(m) => String(m.user.id)}
                defaultSort={{ key: 'person', dir: 'asc' }} renderCard={renderCard} renderCardActions={menuFor}
                loading={members.isLoading}
                empty={<EmptyState title="No team members match" description="Try a different name, job title or skill." />} />
            </Box>
            <FootNote note="Planned hours are project allocations, not hours already worked." end={`As of ${formatDate(nyTodayIso())}`} />
          </>
        )}
      </Paper>
      {dialog ? <MemberDialog projectId={project.id} member={dialog.member} people={available} onClose={() => setDialog(null)} /> : null}
      <ConfirmDialog open={Boolean(removing)} title={removing ? `Remove ${nameOf(removing)} from ${project.name}?` : ''}
        confirmLabel="Remove" busy={remove.isPending} body="They're also taken off its milestones."
        onClose={() => setRemoving(null)}
        onConfirm={async () => { await remove.mutateAsync(removing.user.id); setRemoving(null) }} />
    </Stack>
  )
}
