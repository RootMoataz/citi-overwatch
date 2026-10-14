import {
  Button, MenuItem, Paper, Skeleton, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography,
} from '@mui/material'
import { useState } from 'react'
import { useArchive, useRestoreArchived } from '../../api/queries.js'
import ConfirmDialog from '../../components/ConfirmDialog.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import PageHeader from '../../components/PageHeader.jsx'

// Everything that can be archived and restored today, with what restoring it does.
const TYPES = {
  project: { label: 'Project', plural: 'Projects', effect: 'It comes back for its manager and team, and counts toward budgets and workloads again.' },
  milestone: { label: 'Milestone', plural: 'Milestones', effect: 'It comes back on its project, and counts toward progress and budget again.' },
  user: { label: 'Person', plural: 'People', effect: 'The account can sign in again with its existing password.' },
}

const when = (iso) => (iso ? new Date(iso).toLocaleString() : '—')

export default function ArchivePage() {
  const archive = useArchive()
  const restore = useRestoreArchived()
  const [type, setType] = useState('')
  const [confirm, setConfirm] = useState(null)
  const [failure, setFailure] = useState(null)
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

  return (
    <>
      <PageHeader title="Archive" subtitle="Everything archived, in one place. Restoring brings a record back exactly as it was." />
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <TextField select label="Type" value={type} onChange={(e) => setType(e.target.value)} sx={{ minWidth: 220 }}>
          <MenuItem value="">Everything ({all.length})</MenuItem>
          {Object.entries(TYPES).map(([t, meta]) => <MenuItem key={t} value={t}>{meta.plural} ({count(t)})</MenuItem>)}
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
                  <TableCell>{i.archived_by?.name ?? '—'}</TableCell>
                  <TableCell align="right">
                    <Button size="small" variant="outlined" aria-label={`Restore ${i.name}`} onClick={() => setConfirm(i)}>Restore</Button>
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
