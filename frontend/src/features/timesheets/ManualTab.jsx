import { Box, Button, Chip, Collapse, Dialog, DialogActions, DialogContent, DialogTitle, Paper, Skeleton, Stack, Table,
  TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material'
import { useId, useState } from 'react'
import { useMediaQuery } from 'react-responsive'
import { useApproveManual, useManualHours, useRequestManualChanges } from '../../api/queries.js'
import Critical from '../../components/Critical.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import PersonLink from '../../components/PersonLink.jsx'
import UserAvatar from '../../components/UserAvatar.jsx'
import { formatDayShort, formatHours } from '../../lib/format.js'
import { DESKTOP_QUERY } from '../../lib/responsive.js'
import BreakdownPanel from '../approvals/BreakdownPanel.jsx'
import FlagChips from '../timer/FlagChips.jsx'
import { REASONS } from '../timer/manualHours.js'

const REASON_MAX = 1000   // the server's limit on a reason sent back to the employee
const REASON_LABEL = Object.fromEntries(REASONS)
const COLUMNS = ['Person', 'Date', 'Milestone', 'Hours', 'Why not the timer', 'Work note', 'Flags']
const CHIP_SX = { height: 20, fontSize: '0.72rem' }
const TOUCH = { minHeight: { xs: 44, md: 'auto' } }

const firstName = (name) => String(name ?? '').trim().split(/\s+/)[0]
const dayOf = (item) => formatDayShort(item.entry.work_date)
const whoWhen = (item) => `${item.user.name}, ${dayOf(item)}`

function RequestChangesDialog({ item, busy, onSubmit, onClose }) {
  const titleId = useId()
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const send = () => {
    if (!reason.trim()) { setError('Tell the employee why'); return }
    onSubmit(reason.trim())
  }
  return (
    <Dialog open onClose={busy ? undefined : onClose} aria-labelledby={titleId} maxWidth="xs" fullWidth>
      <DialogTitle id={titleId}>Request changes</DialogTitle>
      <DialogContent>
        <Stack sx={{ gap: 2, pt: 1 }}>
          <Typography variant="body2">
            {firstName(item.user.name)} sees your reason on their timesheet and can fix and resubmit.
          </Typography>
          <TextField label="Reason" required multiline minRows={2} value={reason} autoFocus error={Boolean(error)}
            helperText={error} slotProps={{ htmlInput: { maxLength: REASON_MAX } }}
            onChange={(e) => { setReason(e.target.value); setError('') }} />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={busy} sx={{ minHeight: 44 }}>Cancel</Button>
        <Button variant="contained" onClick={send} disabled={busy} sx={{ minHeight: 44 }}>Request changes</Button>
      </DialogActions>
    </Dialog>
  )
}

/** The reason the person gave for not using the timer, with the details they wrote under it. */
function Why({ item }) {
  const { reason, details } = item.entry.manual ?? {}
  return (
    <>
      <Typography variant="body2">{REASON_LABEL[reason] ?? reason}</Typography>
      {details ? <Typography variant="body2" sx={{ color: 'text.secondary', overflowWrap: 'anywhere' }}>{details}</Typography> : null}
    </>
  )
}

function Flags({ item }) {
  return (
    <Stack direction="row" useFlexGap sx={{ gap: 0.5, flexWrap: 'wrap', alignItems: 'center' }}>
      <FlagChips flags={item.flags} />
      {item.entry.over_40 ? (
        <Chip size="small" variant="outlined" color="warning" data-tone="warning" label={<Critical>Overtime</Critical>} sx={CHIP_SX} />
      ) : null}
      {item.entry.edited_after_decision ? (
        <Chip size="small" variant="outlined" data-tone="neutral" label="Edited after a decision" sx={CHIP_SX} />
      ) : null}
      {item.delegated_from ? (
        <Chip size="small" variant="outlined" color="info" label={`Delegated from ${item.delegated_from.name}`} sx={CHIP_SX} />
      ) : null}
    </Stack>
  )
}

function Actions({ item, busy, open, onToggle, onRequest, onApprove, sx }) {
  const hours = formatHours(item.entry.hours)
  const sizing = { ...TOUCH, whiteSpace: 'nowrap' }
  return (
    <Stack direction="row" useFlexGap sx={{ gap: 1, flexWrap: 'wrap', alignItems: 'center', ...sx }}>
      <Button size="small" onClick={onToggle} aria-expanded={open} sx={sizing}
        aria-label={`Budget impact, ${whoWhen(item)}`}>Budget impact</Button>
      <Button size="small" color="error" onClick={onRequest} disabled={busy} sx={sizing}
        aria-label={`Request changes, ${whoWhen(item)}`}>Request changes</Button>
      <Button size="small" variant="contained" onClick={onApprove} disabled={busy} sx={sizing}
        aria-label={`Approve ${hours}, ${whoWhen(item)}`}>Approve {hours}</Button>
    </Stack>
  )
}

/** What sits under an entry: its failure, and its budget impact when opened. */
function Extras({ failure, open, item }) {
  return (
    <>
      <ErrorAlert error={failure?.error} sx={{ mt: 1 }} />
      <Collapse in={open} unmountOnExit><Box sx={{ mt: 1 }}><BreakdownPanel entryId={item.entry.id} /></Box></Collapse>
    </>
  )
}

function PersonCell({ item }) {
  return (
    <Stack direction="row" sx={{ gap: 1, alignItems: 'center' }}>
      <UserAvatar userId={item.user.id} name={item.user.name} />
      <PersonLink person={item.user} context={{ managed: true }} />
    </Stack>
  )
}

function TableList({ items, rowProps }) {
  return (
    <Table aria-label="Manual hours" size="small" sx={{ '& .MuiTableCell-root': { verticalAlign: 'top' } }}>
      <TableHead>
        <TableRow>
          {COLUMNS.map((c) => <TableCell key={c}>{c}</TableCell>)}
          <TableCell><Box component="span" sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Actions</Box></TableCell>
        </TableRow>
      </TableHead>
      {items.map((item) => {
        const p = rowProps(item)
        return (
          <TableBody key={item.entry.id}>
            <TableRow sx={p.extras ? { '& > td': { borderBottom: 0 } } : undefined}>
              <TableCell><PersonCell item={item} /></TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>{dayOf(item)}</TableCell>
              <TableCell>
                {item.milestone.name}
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>{item.project.name}</Typography>
              </TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatHours(item.entry.hours)}</TableCell>
              <TableCell><Why item={item} /></TableCell>
              <TableCell sx={{ overflowWrap: 'anywhere' }}>{item.entry.note}</TableCell>
              <TableCell><Flags item={item} /></TableCell>
              <TableCell><Actions item={item} {...p.actions} /></TableCell>
            </TableRow>
            {p.extras ? (
              <TableRow><TableCell colSpan={COLUMNS.length + 1}>{p.extras}</TableCell></TableRow>
            ) : null}
          </TableBody>
        )
      })}
    </Table>
  )
}

function CardList({ items, rowProps }) {
  return (
    <Stack sx={{ gap: 2 }}>
      {items.map((item) => {
        const p = rowProps(item)
        return (
          <Paper key={item.entry.id} component="article" variant="outlined" sx={{ p: 2 }}>
            <Stack sx={{ gap: 1 }}>
              <PersonCell item={item} />
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{dayOf(item)} · {formatHours(item.entry.hours)}</Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>{item.milestone.name} · {item.project.name}</Typography>
              <Box><Why item={item} /></Box>
              {item.entry.note ? <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{item.entry.note}</Typography> : null}
              <Flags item={item} />
              <Actions item={item} {...p.actions} sx={{ mt: 0.5 }} />
              {p.extras}
            </Stack>
          </Paper>
        )
      })}
    </Stack>
  )
}

/** Manual-hours requests waiting for the viewer, one decision each (spec §7). `filters` (user, project, milestone) come
 * from alerts and links. A failure stays on its row while the row is listed; once a refetch drops the row (withdrawn,
 * decided elsewhere) it moves to the top of the list, titled with the person and day, so it is never lost. */
export default function ManualTab({ filters, onClearFilters }) {
  const desktop = useMediaQuery(DESKTOP_QUERY)
  const manual = useManualHours(filters)
  const approve = useApproveManual()
  const requestChanges = useRequestManualChanges()
  const [failures, setFailures] = useState([])   // [{ id, title, error }]
  const [opened, setOpened] = useState(() => new Set())
  const [asking, setAsking] = useState(null)     // the item whose Request changes dialog is open
  const items = manual.data ?? []
  const busy = approve.isPending || requestChanges.isPending

  const attempt = async (item, run) => {
    const id = item.entry.id
    setFailures((all) => all.filter((f) => f.id !== id))
    try {
      await run()
      return true
    } catch (error) {
      setFailures((all) => [...all.filter((f) => f.id !== id), { id, error, title: `${item.user.name} · ${dayOf(item)}` }])
      manual.refetch()
      return false
    }
  }
  const decide = (item) => attempt(item, () => approve.mutateAsync({ item }))
  const sendBack = async (item, reason) => {
    // Close only once the server accepted it; on a failure the dialog keeps the typed reason.
    if (await attempt(item, () => requestChanges.mutateAsync({ item, reason }))) setAsking(null)
  }
  const toggle = (id) => setOpened((prev) => { const next = new Set(prev); if (!next.delete(id)) next.add(id); return next })

  const listed = new Set(items.map((i) => i.entry.id))
  const gone = failures.filter((f) => !listed.has(f.id))
  const rowProps = (item) => {
    const id = item.entry.id
    const failure = failures.find((f) => f.id === id)
    const open = opened.has(id)
    return {
      actions: { busy, open, onToggle: () => toggle(id), onRequest: () => setAsking(item), onApprove: () => decide(item) },
      extras: failure || open ? <Extras failure={failure} open={open} item={item} /> : null,
    }
  }

  return (
    <>
      <Stack direction="row" sx={{ gap: 1, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        <Typography variant="body2" sx={{ color: 'text.secondary', flexGrow: 1 }}>
          Hours logged without the timer. Each needs its own decision; Approve week never includes them.
        </Typography>
        {Object.keys(filters).length ? <Button onClick={onClearFilters} sx={TOUCH}>Show everyone</Button> : null}
      </Stack>
      <ErrorAlert error={manual.error} onRetry={() => manual.refetch()} sx={{ mb: 2 }} />
      {gone.map((f) => <ErrorAlert key={f.id} error={f.error} title={f.title} sx={{ mb: 2 }} />)}
      {manual.isLoading ? <Skeleton variant="rounded" height={200} /> : null}
      {!manual.isLoading && !manual.error && items.length === 0 ? (
        <EmptyState title="No manual hours waiting" description="Hours your team logs without the timer show up here." />
      ) : null}
      {items.length ? (desktop ? <TableList items={items} rowProps={rowProps} /> : <CardList items={items} rowProps={rowProps} />) : null}
      {asking ? (
        <RequestChangesDialog item={asking} busy={requestChanges.isPending} onClose={() => setAsking(null)}
          onSubmit={(reason) => sendBack(asking, reason)} />
      ) : null}
    </>
  )
}
