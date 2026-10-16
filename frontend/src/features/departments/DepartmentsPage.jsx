import {
  Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Paper, Skeleton, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, TextField,
} from '@mui/material'
import { useId, useState } from 'react'
import {
  useArchiveDepartment, useCreateDepartment, useDepartments, useRenameDepartment, useRestoreDepartment,
} from '../../api/queries.js'
import { useSession } from '../../auth/sessionContext.js'
import ConfirmDialog from '../../components/ConfirmDialog.jsx'
import { DemoAccessNotice } from '../../app/DemoSession.jsx'
import DemoLock from '../../components/DemoLock.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import { useRedirectOnDenied } from '../../app/access.js'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import PageHeader from '../../components/PageHeader.jsx'
import { demoBlocks } from '../../lib/permissions.js'

const TAKEN = 'A department with this name already exists'
const nameError = (err) => (err?.details?.name === 'taken' ? TAKEN : null)

function RenameDialog({ department, onClose }) {
  const titleId = useId()
  const rename = useRenameDepartment()
  const [name, setName] = useState(department.name)
  const [failure, setFailure] = useState(null)
  const save = async (e) => {
    e.preventDefault()
    setFailure(null)
    try {
      await rename.mutateAsync({ id: department.id, name })
      onClose()
    } catch (err) { setFailure(err) }
  }
  return (
    <Dialog open onClose={rename.isPending ? undefined : onClose} aria-labelledby={titleId} maxWidth="xs" fullWidth>
      <form noValidate onSubmit={save}>
        <DialogTitle id={titleId}>Rename {department.name}</DialogTitle>
        <DialogContent>
          {failure && !nameError(failure) ? <ErrorAlert error={failure} sx={{ mb: 2 }} /> : null}
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus
            error={Boolean(nameError(failure))} helperText={nameError(failure)} sx={{ mt: 1 }}
            slotProps={{ htmlInput: { maxLength: 80 } }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={rename.isPending}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={rename.isPending || !name.trim()}>Save</Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

/** Admins add, rename, archive and restore departments; people and projects are put in one from their own forms. */
export default function DepartmentsPage() {
  const { user } = useSession()
  const locked = demoBlocks(user, 'departments.manage')
  const departments = useDepartments({ includeArchived: true })
  const create = useCreateDepartment()
  const archive = useArchiveDepartment()
  const restore = useRestoreDepartment()
  const [name, setName] = useState('')
  const [addFailure, setAddFailure] = useState(null)
  const [renaming, setRenaming] = useState(null)
  const [archiving, setArchiving] = useState(null)
  const [failure, setFailure] = useState(null)
  const leaving = useRedirectOnDenied(departments.error)
  const items = departments.data?.items ?? []

  const add = async (e) => {
    e.preventDefault()
    setAddFailure(null)
    try {
      await create.mutateAsync({ name })
      setName('')
    } catch (err) { setAddFailure(err) }
  }

  const act = async (mutation, department) => {
    setFailure(null)
    try { await mutation.mutateAsync(department) } catch (err) { setFailure(err) }
  }

  if (leaving) return null
  return (
    <>
      <PageHeader title="Departments"
        subtitle="Group people and projects by department. The dashboard can then be narrowed to one department." />
      <DemoAccessNotice text="Demo access · Adding, renaming and archiving departments is disabled." />
      <Paper variant="outlined" component="form" noValidate onSubmit={add} sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 2, alignItems: { sm: 'flex-start' } }}>
          <TextField label="New department" value={name} onChange={(e) => setName(e.target.value)}
            error={Boolean(nameError(addFailure))} helperText={nameError(addFailure)} sx={{ minWidth: 280 }}
            slotProps={{ htmlInput: { maxLength: 80 } }} disabled={locked} />
          <DemoLock user={user} action="departments.manage">
            <Button type="submit" variant="contained" disabled={create.isPending || !name.trim()} sx={{ mt: { sm: 1 } }}>Add</Button>
          </DemoLock>
        </Stack>
        {addFailure && !nameError(addFailure) ? <ErrorAlert error={addFailure} sx={{ mt: 2 }} /> : null}
      </Paper>
      <ErrorAlert error={failure} sx={{ mb: 2 }} />
      <ErrorAlert error={departments.error} onRetry={() => departments.refetch()} sx={{ mb: 2 }} />
      {departments.isLoading ? <Skeleton variant="rounded" height={200} /> : null}
      {!departments.isLoading && !departments.error && !items.length ? (
        <EmptyState title="No departments yet" description="Add one above, then put people and projects in it." />
      ) : null}
      {items.length ? (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small" aria-label="Departments">
            <TableHead><TableRow><TableCell>Name</TableCell><TableCell align="right">People</TableCell>
              <TableCell align="right">Projects</TableCell><TableCell /></TableRow></TableHead>
            <TableBody>
              {items.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>
                    {d.name}
                    {d.is_archived ? <Chip size="small" label="Archived" sx={{ ml: 1 }} /> : null}
                  </TableCell>
                  <TableCell align="right">{d.user_count}</TableCell>
                  <TableCell align="right">{d.project_count}</TableCell>
                  <TableCell align="right">
                    <Stack direction="row" sx={{ gap: 1, justifyContent: 'flex-end' }}>
                      <DemoLock user={user} action="departments.manage">
                        <Button size="small" aria-label={`Rename ${d.name}`} onClick={() => setRenaming(d)}>Rename</Button>
                      </DemoLock>
                      <DemoLock user={user} action="departments.manage">
                        {d.is_archived ? (
                          <Button size="small" variant="outlined" aria-label={`Restore ${d.name}`}
                            disabled={restore.isPending} onClick={() => act(restore, d)}>Restore</Button>
                        ) : (
                          <Button size="small" color="error" aria-label={`Archive ${d.name}`}
                            onClick={() => setArchiving(d)}>Archive</Button>
                        )}
                      </DemoLock>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      ) : null}
      {renaming ? <RenameDialog department={renaming} onClose={() => setRenaming(null)} /> : null}
      <ConfirmDialog open={Boolean(archiving)} title={archiving ? `Archive ${archiving.name}?` : ''} confirmLabel="Archive"
        busy={archive.isPending}
        body="It disappears from the department pickers and the dashboard filter. People and projects already in it keep it until someone changes them. You can restore it here."
        onClose={() => setArchiving(null)}
        onConfirm={async () => { await act(archive, archiving); setArchiving(null) }} />
    </>
  )
}
