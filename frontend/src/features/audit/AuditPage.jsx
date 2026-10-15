import Settings from '@mui/icons-material/SettingsOutlined'
import {
  Autocomplete, Avatar, Box, Button, Chip, Collapse, Link, MenuItem, Pagination, Paper, Skeleton, Stack, TextField, Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { useAuditLog, useEveryone } from '../../api/queries.js'
import EmptyState from '../../components/EmptyState.jsx'
import { useRedirectOnDenied } from '../../app/access.js'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import ExportCsvButton from '../../components/ExportCsvButton.jsx'
import { utcIso } from '../../lib/csv.js'
import PageHeader from '../../components/PageHeader.jsx'
import PersonLink from '../../components/PersonLink.jsx'
import UserAvatar from '../../components/UserAvatar.jsx'
import { changedFields, groupByDay, humanize, lookFor, predicateFor, sentenceFor } from './auditLook.js'

const TYPES = ['user', 'project', 'project_request', 'milestone', 'time_entry', 'department']
// Every action the backend records (see audit.record calls), most common first.
const ACTIONS = ['create', 'update', 'archive', 'restore', 'approve', 'reject', 'complete', 'status_change', 'log', 'edit',
  'delete_draft', 'claim', 'add_member', 'update_member', 'remove_member', 'set_assignees', 'set_dependencies',
  'auto_assign_support', 'add_note', 'create_from_request', 'avatar_set', 'avatar_remove', 'login', 'password_change',
  'password_reset', 'password_reset_by_admin']
const PAGE_SIZE = 50
const personLabel = (p) => `${p.first_name} ${p.last_name}${p.is_archived ? ' (archived)' : ''}`

const CSV_COLUMNS = [
  { header: 'When (UTC)', value: (e) => utcIso(e.created_at) },
  { header: 'Who', value: (e) => e.actor.name },
  { header: 'Action', value: (e) => humanize(e.action) },
  { header: 'Summary', value: (e) => sentenceFor(e) },
  { header: 'Record type', value: (e) => humanize(e.entity_type) },
  { header: 'Record id', value: (e) => e.entity_id },
  { header: 'Changes', value: (e) => changedFields(e.changes)
    .map((f) => `${f.field}: ${f.from === null ? f.to : `${f.from} -> ${f.to}`}`).join('; ') },
  { header: 'Request id', value: (e) => e.request_id },
]

const timeOf = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

function Actor({ actor }) {
  if (!actor?.id) {
    return (
      <Avatar aria-hidden sx={{ width: 28, height: 28, bgcolor: 'action.selected', color: 'text.secondary' }}>
        <Settings sx={{ fontSize: 18 }} />
      </Avatar>
    )
  }
  return <UserAvatar userId={actor.id} name={actor.name} />
}

/** "Status: In progress → Completed", one row per changed field; a create shows just the new values. */
function ChangeList({ changes }) {
  const fields = changedFields(changes)
  if (!fields.length) return null
  return (
    <Box component="ul" aria-label="Changed fields" sx={{ m: 0, mt: 1, p: 0, listStyle: 'none', display: 'grid', gap: 0.5 }}>
      {fields.map((f) => (
        <Box component="li" key={f.field} aria-label={`${f.field}: ${f.from === null ? f.to : `${f.from} → ${f.to}`}`}
          sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.75, fontSize: 13 }}>
          <Typography component="span" variant="body2" sx={{ fontWeight: 600, minWidth: 0 }}>{f.field}:</Typography>
          {f.from !== null ? (
            <>
              <Chip size="small" variant="outlined" label={f.from}
                sx={{ maxWidth: 260, textDecoration: 'line-through', color: 'text.secondary' }} />
              <Typography component="span" aria-hidden sx={{ color: 'text.secondary' }}>→</Typography>
            </>
          ) : null}
          <Chip size="small" label={f.to} sx={(theme) => ({ maxWidth: 260, fontWeight: 600,
            bgcolor: alpha(theme.palette.success.main, theme.palette.mode === 'dark' ? 0.22 : 0.12) })} />
        </Box>
      ))}
    </Box>
  )
}

function Entry({ entry, last }) {
  const [raw, setRaw] = useState(false)
  const { Icon, color } = lookFor(entry)
  const project = entry.summary?.project
  return (
    <Box component="li" sx={{ display: 'grid', gridTemplateColumns: '40px 1fr', columnGap: { xs: 1, sm: 1.5 }, position: 'relative' }}>
      {/* The rail: an icon per action, joined to the next entry by a line. */}
      <Box sx={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
        {!last ? <Box aria-hidden sx={{ position: 'absolute', top: 40, bottom: -4, width: 2, bgcolor: 'divider' }} /> : null}
        <Box aria-hidden sx={(theme) => ({ width: 36, height: 36, mt: 0.5, borderRadius: '50%', display: 'grid', placeItems: 'center',
          color: theme.palette[color].main, bgcolor: alpha(theme.palette[color].main, theme.palette.mode === 'dark' ? 0.2 : 0.1),
          border: 1, borderColor: alpha(theme.palette[color].main, 0.35) })}>
          <Icon fontSize="small" />
        </Box>
      </Box>
      <Paper variant="outlined" sx={{ p: 1.5, mb: 1.5, minWidth: 0 }}>
        <Stack direction="row" sx={{ gap: 1.25, alignItems: 'flex-start' }}>
          <Actor actor={entry.actor} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
              <Box component="span" sx={{ fontWeight: 700 }}>
                {entry.actor?.id ? <PersonLink person={entry.actor} /> : entry.actor?.name ?? 'System'}
              </Box>{' '}
              {predicateFor(entry)}
            </Typography>
            <Stack direction="row" useFlexGap sx={{ gap: 0.75, mt: 0.75, flexWrap: 'wrap', alignItems: 'center' }}>
              <Chip size="small" variant="outlined" label={humanize(entry.entity_type)} />
              {project ? (
                <Chip size="small" variant="outlined" color="primary" clickable component={RouterLink} to={`/projects/${project.id}`}
                  label={project.name} />
              ) : null}
            </Stack>
            <ChangeList changes={entry.changes} />
            {entry.changes ? (
              <>
                <Button size="small" aria-expanded={raw} onClick={() => setRaw(!raw)} sx={{ mt: 0.5, ml: -1 }}>
                  {raw ? 'Hide raw JSON' : 'Show raw JSON'}
                </Button>
                <Collapse in={raw} unmountOnExit>
                  <Typography variant="caption" component="p" sx={{ color: 'text.secondary' }}>request id: {entry.request_id}</Typography>
                  <Box component="pre" sx={{ m: 0, mt: 0.5, p: 1.5, borderRadius: 1, bgcolor: 'action.hover', fontSize: 12, overflowX: 'auto' }}>
                    {JSON.stringify(entry.changes, null, 2)}
                  </Box>
                </Collapse>
              </>
            ) : null}
          </Box>
          <Typography component="time" dateTime={entry.created_at} title={new Date(entry.created_at).toLocaleString()}
            variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'nowrap', pt: 0.25 }}>
            {timeOf(entry.created_at)}
          </Typography>
        </Stack>
      </Paper>
    </Box>
  )
}

function Timeline({ items }) {
  return (
    <Stack sx={{ gap: 2 }}>
      {groupByDay(items).map((day) => (
        <Box component="section" key={day.key} aria-label={day.label}>
          <Stack direction="row" sx={{ alignItems: 'baseline', gap: 1, mb: 1 }}>
            <Typography variant="h3" component="h2">{day.label}</Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {day.items.length} {day.items.length === 1 ? 'entry' : 'entries'}
            </Typography>
          </Stack>
          <Box component="ol" aria-label={`Entries for ${day.label}`} sx={{ listStyle: 'none', p: 0, m: 0 }}>
            {day.items.map((e, i) => <Entry key={e.id} entry={e} last={i === day.items.length - 1} />)}
          </Box>
        </Box>
      ))}
    </Stack>
  )
}

export default function AuditPage() {
  const [filters, setFilters] = useState({ actor: '', action: '', entity_type: '', from: '', to: '' })
  const [page, setPage] = useState(1)
  const audit = useAuditLog({ ...filters, page, page_size: PAGE_SIZE })
  const people = useEveryone()
  const leaving = useRedirectOnDenied(audit.error)
  const who = (people.data ?? []).find((p) => String(p.id) === filters.actor) ?? null
  const items = audit.data?.items ?? []
  const pages = Math.max(1, Math.ceil((audit.data?.total ?? 0) / PAGE_SIZE))
  const change = (next) => { setFilters((f) => ({ ...f, ...next })); setPage(1) }
  const set = (k) => (e) => change({ [k]: e.target.value })
  if (leaving) return null
  return (
    <>
      <PageHeader title="Audit log" subtitle="Every change, who made it and when. Entries can't be edited or deleted."
        actions={<ExportCsvButton name="audit-log" columns={CSV_COLUMNS} rows={items} />} />
      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} sx={{ gap: 2 }}>
          <Autocomplete options={people.data ?? []} value={who} loading={people.isLoading} sx={{ flex: 1 }}
            getOptionLabel={personLabel} isOptionEqualToValue={(o, v) => String(o.id) === String(v.id)}
            onChange={(_, p) => change({ actor: p ? String(p.id) : '' })}
            renderInput={(params) => <TextField {...params} label="Who" placeholder="Anyone" />} />
          <TextField select label="Action" value={filters.action} onChange={set('action')} sx={{ flex: 1 }}>
            <MenuItem value="">Any action</MenuItem>
            {ACTIONS.map((a) => <MenuItem key={a} value={a}>{humanize(a)}</MenuItem>)}
          </TextField>
          <TextField select label="Record type" value={filters.entity_type} onChange={set('entity_type')} sx={{ flex: 1 }}>
            <MenuItem value="">Everything</MenuItem>
            {TYPES.map((t) => <MenuItem key={t} value={t}>{humanize(t)}</MenuItem>)}
          </TextField>
          <TextField label="From" type="date" value={filters.from} onChange={set('from')} slotProps={{ inputLabel: { shrink: true } }} sx={{ flex: 1 }} />
          <TextField label="To" type="date" value={filters.to} onChange={set('to')} slotProps={{ inputLabel: { shrink: true } }} sx={{ flex: 1 }} />
        </Stack>
      </Paper>
      <ErrorAlert error={audit.error} onRetry={() => audit.refetch()} sx={{ mb: 2 }} />
      {audit.isLoading ? <Skeleton variant="rounded" height={240} /> : null}
      {!audit.isLoading && !items.length ? <EmptyState title="No entries for these filters" /> : null}
      {items.length ? <Timeline items={items} /> : null}
      {pages > 1 ? (
        <Stack sx={{ alignItems: 'center', mt: 2, gap: 1 }}>
          <Pagination count={pages} page={page} onChange={(_, p) => setPage(p)} color="primary" shape="rounded"
            aria-label="Audit log pages" />
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {audit.data.total} entries · page {page} of {pages}
          </Typography>
          <Link component="button" variant="caption" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>Back to top</Link>
        </Stack>
      ) : null}
    </>
  )
}
