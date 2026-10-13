import {
  Box, Button, Collapse, MenuItem, Paper, Skeleton, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TextField, Typography,
} from '@mui/material'
import { Fragment, useState } from 'react'
import { useAuditLog } from '../../api/queries.js'
import EmptyState from '../../components/EmptyState.jsx'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import PageHeader from '../../components/PageHeader.jsx'

const TYPES = ['user', 'project', 'project_request', 'milestone', 'time_entry']
const label = (s) => s.replace(/_/g, ' ')

export default function AuditPage() {
  const [filters, setFilters] = useState({ entity_type: '', from: '', to: '' })
  const [open, setOpen] = useState(null)
  const audit = useAuditLog(filters)
  const items = audit.data?.items ?? []
  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }))
  return (
    <>
      <PageHeader title="Audit log" subtitle="Every change, who made it and when. Entries can't be edited or deleted." />
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} sx={{ gap: 2 }}>
          <TextField select label="Record type" value={filters.entity_type} onChange={set('entity_type')} sx={{ flex: 1 }}>
            <MenuItem value="">Everything</MenuItem>
            {TYPES.map((t) => <MenuItem key={t} value={t}>{label(t)}</MenuItem>)}
          </TextField>
          <TextField label="From" type="date" value={filters.from} onChange={set('from')} slotProps={{ inputLabel: { shrink: true } }} sx={{ flex: 1 }} />
          <TextField label="To" type="date" value={filters.to} onChange={set('to')} slotProps={{ inputLabel: { shrink: true } }} sx={{ flex: 1 }} />
        </Stack>
      </Paper>
      <ErrorAlert error={audit.error} onRetry={() => audit.refetch()} sx={{ mb: 2 }} />
      {audit.isLoading ? <Skeleton variant="rounded" height={240} /> : null}
      {!audit.isLoading && !items.length ? <EmptyState title="No entries for these filters" /> : null}
      {items.length ? (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small" aria-label="Audit entries">
            <TableHead><TableRow><TableCell>When</TableCell><TableCell>Who</TableCell><TableCell>Action</TableCell>
              <TableCell>Record</TableCell><TableCell /></TableRow></TableHead>
            <TableBody>
              {items.map((e) => (
                <Fragment key={e.id}>
                  <TableRow>
                    <TableCell>{new Date(e.created_at).toLocaleString()}</TableCell>
                    <TableCell>{e.actor.name}</TableCell>
                    <TableCell>{label(e.action)}</TableCell>
                    <TableCell>{label(e.entity_type)}<Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>{e.entity_id}</Typography></TableCell>
                    <TableCell align="right">
                      {e.changes ? <Button size="small" aria-expanded={open === e.id} onClick={() => setOpen(open === e.id ? null : e.id)}>
                        {open === e.id ? 'Hide changes' : 'Show changes'}</Button> : null}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell colSpan={5} sx={{ p: 0, borderBottom: open === e.id ? undefined : 'none' }}>
                      <Collapse in={open === e.id} unmountOnExit>
                        <Box component="pre" sx={{ m: 0, p: 2, bgcolor: 'action.hover', fontSize: 13, overflowX: 'auto' }}>
                          {JSON.stringify(e.changes, null, 2)}
                        </Box>
                        <Typography variant="caption" sx={{ px: 2, pb: 1, display: 'block', color: 'text.secondary' }}>request id: {e.request_id}</Typography>
                      </Collapse>
                    </TableCell>
                  </TableRow>
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      ) : null}
    </>
  )
}
