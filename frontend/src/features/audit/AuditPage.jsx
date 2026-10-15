import {
  Autocomplete, Box, Button, Collapse, MenuItem, Paper, Skeleton, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TextField, Typography,
} from '@mui/material'
import { Fragment, useState } from 'react'
import { useAuditLog, useEveryone } from '../../api/queries.js'
import EmptyState from '../../components/EmptyState.jsx'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import PageHeader from '../../components/PageHeader.jsx'
import PersonLink from '../../components/PersonLink.jsx'

const TYPES = ['user', 'project', 'project_request', 'milestone', 'time_entry']
// Every action the backend records (see audit.record calls), most common first.
const ACTIONS = ['create', 'update', 'archive', 'restore', 'approve', 'reject', 'complete', 'status_change', 'log', 'edit',
  'delete_draft', 'add_member', 'update_member', 'remove_member', 'set_assignees', 'set_dependencies', 'auto_assign_support',
  'add_note', 'create_from_request', 'login', 'password_change', 'password_reset', 'password_reset_by_admin']
const label = (s) => s.replace(/_/g, ' ')
const personLabel = (p) => `${p.first_name} ${p.last_name}${p.is_archived ? ' (archived)' : ''}`
const show = (v) => (v == null || v === '' ? '—' : Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v))

/** One {field, from, to} per field whose value differs; `from` is null on a create (there was no before). */
function changedFields(changes) {
  const before = changes?.before ?? null
  const after = changes?.after ?? null
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])]
  return keys.filter((k) => JSON.stringify(before?.[k] ?? null) !== JSON.stringify(after?.[k] ?? null))
    .map((k) => ({ field: label(k), from: before ? show(before[k]) : null, to: show(after?.[k]) }))
}

function ChangeList({ changes }) {
  const fields = changedFields(changes)
  if (!fields.length) return <Typography variant="body2" sx={{ px: 2, pt: 2, color: 'text.secondary' }}>No field values recorded for this action.</Typography>
  return (
    <Box component="ul" aria-label="Changed fields" sx={{ m: 0, px: 4, pt: 2, pb: 0 }}>
      {fields.map((f) => (
        <Typography component="li" variant="body2" key={f.field}>
          <b>{f.field}</b>: {f.from === null ? f.to : `${f.from} → ${f.to}`}
        </Typography>
      ))}
    </Box>
  )
}

export default function AuditPage() {
  const [filters, setFilters] = useState({ actor: '', action: '', entity_type: '', from: '', to: '' })
  const [open, setOpen] = useState(null)
  const [raw, setRaw] = useState(null)
  const audit = useAuditLog(filters)
  const people = useEveryone()
  const who = (people.data ?? []).find((p) => String(p.id) === filters.actor) ?? null
  const items = audit.data?.items ?? []
  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }))
  return (
    <>
      <PageHeader title="Audit log" subtitle="Every change, who made it and when. Entries can't be edited or deleted." />
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} sx={{ gap: 2 }}>
          <Autocomplete options={people.data ?? []} value={who} loading={people.isLoading} sx={{ flex: 1 }}
            getOptionLabel={personLabel} isOptionEqualToValue={(o, v) => String(o.id) === String(v.id)}
            onChange={(_, p) => setFilters((f) => ({ ...f, actor: p ? String(p.id) : '' }))}
            renderInput={(params) => <TextField {...params} label="Who" placeholder="Anyone" />} />
          <TextField select label="Action" value={filters.action} onChange={set('action')} sx={{ flex: 1 }}>
            <MenuItem value="">Any action</MenuItem>
            {ACTIONS.map((a) => <MenuItem key={a} value={a}>{label(a)}</MenuItem>)}
          </TextField>
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
                    <TableCell><PersonLink person={e.actor} /></TableCell>
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
                        <ChangeList changes={e.changes} />
                        <Stack direction="row" sx={{ px: 2, py: 1, gap: 2, alignItems: 'center' }}>
                          <Typography variant="caption" sx={{ color: 'text.secondary' }}>request id: {e.request_id}</Typography>
                          <Button size="small" aria-expanded={raw === e.id} onClick={() => setRaw(raw === e.id ? null : e.id)}>
                            {raw === e.id ? 'Hide raw JSON' : 'Show raw JSON'}</Button>
                        </Stack>
                        {raw === e.id ? (
                          <Box component="pre" sx={{ m: 0, p: 2, bgcolor: 'action.hover', fontSize: 13, overflowX: 'auto' }}>
                            {JSON.stringify(e.changes, null, 2)}
                          </Box>
                        ) : null}
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
