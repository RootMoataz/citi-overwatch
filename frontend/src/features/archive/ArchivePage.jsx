import {
  Button, MenuItem, Paper, Skeleton, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography,
} from '@mui/material'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useArchive, useRestoreArchived } from '../../api/queries.js'
import { useSession } from '../../auth/sessionContext.js'
import ConfirmDialog from '../../components/ConfirmDialog.jsx'
import DemoLock from '../../components/DemoLock.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import { useRedirectOnDenied } from '../../app/access.js'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import ExportCsvButton from '../../components/ExportCsvButton.jsx'
import { utcIso } from '../../lib/csv.js'
import PageHeader from '../../components/PageHeader.jsx'
import PersonLink from '../../components/PersonLink.jsx'
import { can, isReadOnly } from '../../lib/permissions.js'

// Everything that can be archived and restored today, with what restoring it does.
const TYPES = {
  project: { label: 'Project', plural: 'Projects', effect: 'It comes back for its manager and team, and counts toward budgets and workloads again.' },
  milestone: { label: 'Milestone', plural: 'Milestones', effect: 'It comes back on its project, and counts toward progress and budget again.' },
  user: { label: 'Person', plural: 'People', effect: 'The account can sign in again with its existing password.' },
}

const CSV_COLUMNS = [
  { header: 'Name', value: (i) => i.name },
  { header: 'Type', value: (i) => TYPES[i.type]?.label ?? i.type },
  { header: 'Project or username', value: (i) => i.project?.name ?? i.username },
  { header: 'Archived at (UTC)', value: (i) => utcIso(i.archived_at) },
  { header: 'Archived by', value: (i) => i.archived_by?.name },
  { header: 'You can restore it', value: (i) => Boolean(i.can_restore) },
]

// What restoring each type needs from a public demo account; milestones are always fine (backend app/public_demo.py).
const DEMO_ACTION = { project: 'project.archive', user: 'user.manage' }

const when = (iso) => (iso ? new Date(iso).toLocaleString() : '—')

export default function ArchivePage() {
  const { user } = useSession()
  const everything = can(user, 'archive.everything')
  // Managers see the projects they manage and the milestones in them; archived people are for admins and executives.
  const types = Object.entries(TYPES).filter(([t]) => everything || t !== 'user')
  const archive = useArchive()
  const restore = useRestoreArchived()
  // ?type=project (from the home page's projects-by-status card) opens the list already filtered.
  const [params] = useSearchParams()
  const [type, setType] = useState(() => (types.some(([t]) => t === params.get('type')) ? params.get('type') : ''))
  const [confirm, setConfirm] = useState(null)
  const [failure, setFailure] = useState(null)
  const leaving = useRedirectOnDenied(archive.error)
  const all = archive.data?.items ?? []
  const items = type ? all.filter((i) => i.type === type) : all
  const count = (t) => all.filter((i) => i.type === t).length

  const onRestore = async () => {
    const item = confirm
    setFailure(null)
    try {
      await restore.mutateAsync(item)
    } catch (err) {
      setFailure({ item, err })
    }
    setConfirm(null)
  }

  if (leaving) return null
  return (
    <>
      <PageHeader title="Archive" subtitle={isReadOnly(user)
        ? 'Everything archived, in one place. Read-only: only an admin restores records.'
        : everything ? 'Everything archived, in one place. Restoring brings a record back exactly as it was.'
        : 'Archived work from the projects you manage. You can restore milestones; only an admin can restore a project.'}
        actions={<ExportCsvButton name="archive" columns={CSV_COLUMNS} rows={items} />} />
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <TextField select label="Type" value={type} onChange={(e) => setType(e.target.value)} sx={{ minWidth: 220 }}>
          <MenuItem value="">Everything ({all.length})</MenuItem>
          {types.map(([t, meta]) => <MenuItem key={t} value={t}>{meta.plural} ({count(t)})</MenuItem>)}
        </TextField>
      </Paper>
      <ErrorAlert error={failure?.err} title={failure ? `Couldn't restore ${failure.item.name}` : undefined} sx={{ mb: 2 }} />
      <ErrorAlert error={archive.error} onRetry={() => archive.refetch()} sx={{ mb: 2 }} />
      {archive.isLoading ? <Skeleton variant="rounded" height={240} /> : null}
      {!archive.isLoading && !archive.error && !items.length ? (
        <EmptyState title="Nothing is archived" description="Archived projects, milestones and people show up here, ready to restore." />
      ) : null}
      {items.length ? (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small" aria-label="Archived records">
            <TableHead><TableRow><TableCell>Name</TableCell><TableCell>Type</TableCell><TableCell>Archived</TableCell>
              <TableCell>Archived by</TableCell><TableCell /></TableRow></TableHead>
            <TableBody>
              {items.map((i) => (
                <TableRow key={`${i.type}-${i.id}`}>
                  <TableCell>
                    {i.name}
                    {i.project || i.username ? (
                      <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>{i.project?.name ?? i.username}</Typography>
                    ) : null}
                  </TableCell>
                  <TableCell>{TYPES[i.type]?.label ?? i.type}</TableCell>
                  <TableCell>{when(i.archived_at)}</TableCell>
                  <TableCell>{i.archived_by ? <PersonLink person={i.archived_by} /> : '—'}</TableCell>
                  <TableCell align="right">
                    {i.can_restore ? (
                      <DemoLock user={user} action={DEMO_ACTION[i.type]}>
                        <Button size="small" variant="outlined" aria-label={`Restore ${i.name}`} onClick={() => setConfirm(i)}>Restore</Button>
                      </DemoLock>
                    ) : (
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        {i.type === 'project' ? 'Only an admin can restore a project' : 'Restore its project first'}
                      </Typography>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      ) : null}
      <ConfirmDialog open={!!confirm} title={confirm ? `Restore ${confirm.name}?` : ''} confirmLabel="Restore" destructive={false}
        body={confirm ? TYPES[confirm.type]?.effect : null} busy={restore.isPending}
        onClose={() => setConfirm(null)} onConfirm={onRestore} />
    </>
  )
}
