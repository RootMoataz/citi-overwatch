import FileDownload from '@mui/icons-material/FileDownloadOutlined'
import {
  Alert, Box, Button, Checkbox, FormControlLabel, Paper, Skeleton, Stack, Table, TableBody, TableCell, TableHead, TableRow,
  TextField, Typography,
} from '@mui/material'
import { useState } from 'react'
import { fetchHrSubmissionEntries, useHrChanges, useHrPreview, useHrSubmissions, useSubmitHr } from '../../api/queries.js'
import { useSession } from '../../auth/sessionContext.js'
import ConfirmDialog from '../../components/ConfirmDialog.jsx'
import DemoLock from '../../components/DemoLock.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import PersonWithAvatar from '../../components/PersonWithAvatar.jsx'
import StatusChip from '../../components/StatusChip.jsx'
import { downloadCsv } from '../../lib/csv.js'
import { addDays, formatDate, formatDayLabel, formatHours, formatMoney, mondayOf } from '../../lib/format.js'
import { HR_SUBMITTED } from '../../lib/labels.js'
import { can } from '../../lib/permissions.js'
import { payrollCsv } from './payroll.js'

const MAX_DAYS = 31 // the server's longest pay period
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const periodLabel = (p) => `${formatDate(p.period_start)} – ${formatDate(p.period_end)}`

function Section({ title, children, action }) {
  return (
    <Paper component="section" variant="outlined" aria-label={title} sx={{ p: 2 }}>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mb: 1.5 }}>
        <Typography variant="subtitle1" component="h2" sx={{ flexGrow: 1 }}>{title}</Typography>
        {action}
      </Stack>
      {children}
    </Paper>
  )
}

/** Pick a pay period, see what it would send, and submit it (one confirm). */
function SubmitPanel() {
  const { user } = useSession()
  const lastMonday = addDays(mondayOf(), -7)
  const [start, setStart] = useState(lastMonday)
  const [end, setEnd] = useState(addDays(lastMonday, 6))
  const [includeCorrections, setIncludeCorrections] = useState(true)
  const [confirming, setConfirming] = useState(false)
  const [failure, setFailure] = useState(null)
  const days = start && end ? (Date.parse(end) - Date.parse(start)) / 86400000 : -1
  const valid = days >= 0 && days < MAX_DAYS
  const preview = useHrPreview({ period_start: start, period_end: end }, valid)
  const submit = useSubmitHr()
  const p = preview.data
  const corrections = includeCorrections ? (p?.corrections_ready ?? 0) : 0
  const nothing = !p || (p.entry_count === 0 && corrections === 0)
  const send = async () => {
    setFailure(null)
    try {
      await submit.mutateAsync({ period_start: start, period_end: end, include_corrections: includeCorrections })
    } catch (err) { setFailure(err) }
    setConfirming(false)
  }
  return (
    <Section title="Submit a pay period">
      <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 2, mb: 2 }}>
        <TextField label="Period start" type="date" value={start} onChange={(e) => setStart(e.target.value)}
          slotProps={{ inputLabel: { shrink: true } }} />
        <TextField label="Period end" type="date" value={end} onChange={(e) => setEnd(e.target.value)}
          slotProps={{ inputLabel: { shrink: true } }} error={!valid}
          helperText={valid ? 'A week, a fortnight or a month' : `End on or after the start, at most ${MAX_DAYS} days`} />
        <Button sx={{ alignSelf: { sm: 'center' }, whiteSpace: 'nowrap', flexShrink: 0 }} onClick={() => { setStart(lastMonday); setEnd(addDays(lastMonday, 6)) }}>Last week</Button>
      </Stack>
      <ErrorAlert error={preview.error ?? failure} sx={{ mb: 2 }} />
      {valid && preview.isLoading ? <Skeleton variant="rounded" height={64} /> : null}
      {valid && p ? (
        <Stack sx={{ gap: 1 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {plural(p.entry_count, 'approved entry', 'approved entries')} · {formatHours(p.total_hours)} · {formatMoney(p.total_cost)} · {plural(p.people, 'person', 'people')}
          </Typography>
          {p.pending_count ? (
            <Alert severity="info">{plural(p.pending_count, 'entry', 'entries')} in this period still {p.pending_count === 1 ? 'waits' : 'wait'} for approval and won't be included.</Alert>
          ) : null}
          {p.corrections_ready ? (
            <FormControlLabel control={<Checkbox checked={includeCorrections} onChange={(e) => setIncludeCorrections(e.target.checked)} />}
              label={`Include ${plural(p.corrections_ready, 'changed entry', 'changed entries')} ready to re-send (as corrections)`} />
          ) : null}
          {p.corrections_waiting ? (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {plural(p.corrections_waiting, 'changed entry', 'changed entries')} will be ready to re-send once approved or rejected again.
            </Typography>
          ) : null}
          <Box>
            <DemoLock user={user} action="hr.submit">
              <Button variant="contained" disabled={nothing || submit.isPending} onClick={() => setConfirming(true)}>Submit to HR</Button>
            </DemoLock>
          </Box>
        </Stack>
      ) : null}
      <ConfirmDialog open={confirming} destructive={false} busy={submit.isPending} confirmLabel="Submit to HR"
        title={`Submit ${formatDate(start)} – ${formatDate(end)} to HR?`}
        body={p ? `${plural(p.entry_count, 'approved entry', 'approved entries')}${corrections ? ` and ${plural(corrections, 'correction')}` : ''} go into the payroll export. Hours changed later are flagged for re-sending.` : ''}
        onConfirm={send} onClose={() => setConfirming(false)} />
    </Section>
  )
}

/** Hours changed after they were sent to HR: re-sent as corrections in the next submission once decided again. */
function NeedsResubmission() {
  const changes = useHrChanges()
  const rows = changes.data ?? []
  return (
    <Section title={`Needs re-submission (${rows.length})`}>
      <ErrorAlert error={changes.error} onRetry={() => changes.refetch()} />
      {!changes.isLoading && !changes.error && rows.length === 0 ? (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>Nothing changed since it was sent to HR.</Typography>
      ) : null}
      {rows.length ? (
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small" aria-label="Needs re-submission">
            <TableHead>
              <TableRow>
                <TableCell>Person</TableCell><TableCell>Day</TableCell><TableCell>Work</TableCell>
                <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>Sent → now</TableCell><TableCell>Sent in</TableCell><TableCell>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((c) => (
                <TableRow key={c.entry_id}>
                  <TableCell><PersonWithAvatar person={c.user} context={{ managed: true }} /></TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDayLabel(c.work_date)}</TableCell>
                  <TableCell>{c.project.name} › {c.milestone.name}</TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    {formatHours(c.previous_hours)} → {c.status === 'rejected' ? '0h (rejected)' : formatHours(c.hours)}
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{periodLabel(c.previous_submission)}</TableCell>
                  <TableCell>
                    <StatusChip status={c.ready ? 'approved' : 'pending'} label={c.ready ? 'Ready to re-send' : 'Waiting for approval'} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      ) : null}
    </Section>
  )
}

function DownloadPayroll({ submission }) {
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState(null)
  const download = async () => {
    setBusy(true)
    setFailure(null)
    try {
      const { filename, csv } = payrollCsv(await fetchHrSubmissionEntries(submission.id))
      downloadCsv(filename, csv)
    } catch (err) { setFailure(err) }
    setBusy(false)
  }
  return (
    <>
      <Button size="small" variant="outlined" startIcon={<FileDownload />} disabled={busy} onClick={download} sx={{ whiteSpace: 'nowrap' }}
        aria-label={`Payroll CSV for ${periodLabel(submission)}`}>Payroll CSV</Button>
      <ErrorAlert error={failure} sx={{ mt: 1 }} />
    </>
  )
}

function Submissions({ canDownload }) {
  const submissions = useHrSubmissions()
  const rows = submissions.data ?? []
  return (
    <Section title="HR submissions">
      <ErrorAlert error={submissions.error} onRetry={() => submissions.refetch()} />
      {submissions.isLoading ? <Skeleton variant="rounded" height={120} /> : null}
      {!submissions.isLoading && !submissions.error && rows.length === 0 ? (
        <EmptyState title="Nothing sent to HR yet" description="Each pay period submitted to HR is listed here with its payroll export." />
      ) : null}
      {rows.length ? (
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small" aria-label="HR submissions">
            <TableHead>
              <TableRow>
                <TableCell>Pay period</TableCell><TableCell>Status</TableCell><TableCell>Submitted</TableCell>
                <TableCell align="right">People</TableCell><TableCell align="right">Entries</TableCell>
                <TableCell align="right">Hours</TableCell><TableCell align="right">Cost</TableCell>
                {canDownload ? <TableCell>Export</TableCell> : null}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((s) => (
                <TableRow key={s.id}>
                  <TableCell sx={{ minWidth: 140, maxWidth: 200 }}>
                    {formatDate(s.period_start)} –<br />{formatDate(s.period_end)}
                    {s.resubmission_of ? (
                      <Typography variant="caption" component="div" sx={{ color: 'text.secondary' }}>
                        Re-sends changes to {periodLabel(s.resubmission_of)}
                      </Typography>
                    ) : null}
                  </TableCell>
                  <TableCell><StatusChip status="approved" label={HR_SUBMITTED} /></TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    {formatDate(s.submitted_at)}
                    <Typography variant="caption" component="div" sx={{ color: 'text.secondary' }}>by {s.submitted_by.name}</Typography>
                  </TableCell>
                  <TableCell align="right">{s.people}</TableCell>
                  <TableCell align="right">
                    {s.entry_count}
                    {s.correction_count ? (
                      <Typography variant="caption" component="div" sx={{ color: 'text.secondary' }}>
                        incl. {plural(s.correction_count, 'correction')}
                      </Typography>
                    ) : null}
                  </TableCell>
                  <TableCell align="right">{formatHours(s.total_hours)}</TableCell>
                  <TableCell align="right">{formatMoney(s.total_cost)}</TableCell>
                  {canDownload ? <TableCell><DownloadPayroll submission={s} /></TableCell> : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      ) : null}
    </Section>
  )
}

/** Admins send approved hours to HR and download each payroll export; executives read the list. */
export default function HrTab() {
  const { user } = useSession()
  const admin = can(user, 'hr.submit')
  return (
    <Stack sx={{ gap: 2 }}>
      {admin ? (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          There is no HR system to send to: submitting records the pay period and makes its payroll CSV ready to hand over.
          Each approved entry is sent once; if it changes afterwards it's flagged and re-sent as a correction.
        </Typography>
      ) : (
        <Alert severity="info">Read-only: admins submit approved hours to HR. Totals only; per-person pay stays with HR.</Alert>
      )}
      {admin ? <SubmitPanel /> : null}
      {admin ? <NeedsResubmission /> : null}
      <Submissions canDownload={admin} />
    </Stack>
  )
}
