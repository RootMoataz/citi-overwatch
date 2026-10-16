import {
  Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Paper, Skeleton, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, TextField,
} from '@mui/material'
import { useId, useState } from 'react'
import { useArchiveSkill, useCreateSkill, useRenameSkill, useRestoreSkill, useSkills } from '../../api/workflow.js'
import { useRedirectOnDenied } from '../../app/access.js'
import { useSession } from '../../auth/sessionContext.js'
import ConfirmDialog from '../../components/ConfirmDialog.jsx'
import { DemoAccessNotice } from '../../app/DemoSession.jsx'
import DemoLock from '../../components/DemoLock.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import PageHeader from '../../components/PageHeader.jsx'

const MAX = 60
const TAKEN = 'A skill with this name already exists'
const nameError = (err) => (err?.details?.name === 'taken' ? TAKEN : null)

function RenameDialog({ skill, onClose }) {
  const titleId = useId()
  const rename = useRenameSkill()
  const [name, setName] = useState(skill.name)
  const [failure, setFailure] = useState(null)
  const save = async (e) => {
    e.preventDefault()
    setFailure(null)
    try {
      await rename.mutateAsync({ id: skill.id, name })
      onClose()
    } catch (err) { setFailure(err) }
  }
  return (
    <Dialog open onClose={rename.isPending ? undefined : onClose} aria-labelledby={titleId} maxWidth="xs" fullWidth>
      <form noValidate onSubmit={save}>
        <DialogTitle id={titleId}>Rename {skill.name}</DialogTitle>
        <DialogContent>
          {failure && !nameError(failure) ? <ErrorAlert error={failure} sx={{ mb: 2 }} /> : null}
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus
            error={Boolean(nameError(failure))} helperText={nameError(failure)} sx={{ mt: 1 }}
            slotProps={{ htmlInput: { maxLength: MAX } }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={rename.isPending}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={rename.isPending || !name.trim()}>Save</Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

/** Admins keep the skills catalogue: add, rename, archive and restore. Managers then give people skills on their
 * profiles, and milestones list the skills they need for auto-routing. */
export default function SkillsPage() {
  const { user } = useSession()
  const skills = useSkills({ includeArchived: true })
  const create = useCreateSkill()
  const archive = useArchiveSkill()
  const restore = useRestoreSkill()
  const [name, setName] = useState('')
  const [addFailure, setAddFailure] = useState(null)
  const [renaming, setRenaming] = useState(null)
  const [archiving, setArchiving] = useState(null)
  const [failure, setFailure] = useState(null)
  const leaving = useRedirectOnDenied(skills.error)
  const items = skills.data?.items ?? []

  const add = async (e) => {
    e.preventDefault()
    setAddFailure(null)
    try {
      await create.mutateAsync({ name })
      setName('')
    } catch (err) { setAddFailure(err) }
  }

  const act = async (mutation, skill) => {
    setFailure(null)
    try { await mutation.mutateAsync(skill) } catch (err) { setFailure(err) }
  }

  if (leaving) return null
  return (
    <>
      <PageHeader title="Skills"
        subtitle="The skills people can have and milestones can need. Auto-routing matches the two." />
      <DemoAccessNotice page="skills" text="Demo access · Adding, renaming and archiving skills is disabled." />
      <Paper variant="outlined" component="form" noValidate onSubmit={add} sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 2, alignItems: { sm: 'flex-start' } }}>
          <TextField label="New skill" value={name} onChange={(e) => setName(e.target.value)}
            error={Boolean(nameError(addFailure))} helperText={nameError(addFailure)} sx={{ minWidth: 280 }}
            slotProps={{ htmlInput: { maxLength: MAX } }} />
          <DemoLock user={user} action="skills.manage">
            <Button type="submit" variant="contained" disabled={create.isPending || !name.trim()} sx={{ mt: { sm: 1 } }}>Add</Button>
          </DemoLock>
        </Stack>
        {addFailure && !nameError(addFailure) ? <ErrorAlert error={addFailure} sx={{ mt: 2 }} /> : null}
      </Paper>
      <ErrorAlert error={failure} sx={{ mb: 2 }} />
      <ErrorAlert error={skills.error} onRetry={() => skills.refetch()} sx={{ mb: 2 }} />
      {skills.isLoading ? <Skeleton variant="rounded" height={200} /> : null}
      {!skills.isLoading && !skills.error && !items.length ? (
        <EmptyState title="No skills yet" description="Add one above, then give people skills on their profiles." />
      ) : null}
      {items.length ? (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small" aria-label="Skills">
            <TableHead><TableRow><TableCell>Name</TableCell><TableCell align="right">People</TableCell>
              <TableCell align="right">Milestones</TableCell><TableCell /></TableRow></TableHead>
            <TableBody>
              {items.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    {s.name}
                    {s.is_archived ? <Chip size="small" label="Archived" sx={{ ml: 1 }} /> : null}
                  </TableCell>
                  <TableCell align="right">{s.user_count}</TableCell>
                  <TableCell align="right">{s.milestone_count}</TableCell>
                  <TableCell align="right">
                    <Stack direction="row" sx={{ gap: 1, justifyContent: 'flex-end' }}>
                      <DemoLock user={user} action="skills.manage">
                        <Button size="small" aria-label={`Rename ${s.name}`} onClick={() => setRenaming(s)}>Rename</Button>
                      </DemoLock>
                      {s.is_archived ? (
                        <DemoLock user={user} action="skills.manage">
                          <Button size="small" variant="outlined" aria-label={`Restore ${s.name}`}
                            disabled={restore.isPending} onClick={() => act(restore, s)}>Restore</Button>
                        </DemoLock>
                      ) : (
                        <DemoLock user={user} action="skills.manage">
                          <Button size="small" color="error" aria-label={`Archive ${s.name}`}
                            onClick={() => setArchiving(s)}>Archive</Button>
                        </DemoLock>
                      )}
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      ) : null}
      {renaming ? <RenameDialog skill={renaming} onClose={() => setRenaming(null)} /> : null}
      <ConfirmDialog open={Boolean(archiving)} title={archiving ? `Archive ${archiving.name}?` : ''} confirmLabel="Archive"
        busy={archive.isPending}
        body="It disappears from the pickers, the skill chips and auto-routing. People and milestones keep it, so restoring it here brings everything back."
        onClose={() => setArchiving(null)}
        onConfirm={async () => { await act(archive, archiving); setArchiving(null) }} />
    </>
  )
}
