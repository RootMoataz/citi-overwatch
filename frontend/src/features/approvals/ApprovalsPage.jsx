import { Button, Paper, Skeleton, Stack, Typography } from '@mui/material'
import { useSearchParams } from 'react-router-dom'
import { useApprovals } from '../../api/queries.js'
import EmptyState from '../../components/EmptyState.jsx'
import { useRedirectOnDenied } from '../../app/access.js'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import ExportCsvButton from '../../components/ExportCsvButton.jsx'
import PageHeader from '../../components/PageHeader.jsx'
import { num } from '../../lib/csv.js'
import ApprovalRow from './ApprovalRow.jsx'

const CSV_COLUMNS = [
  { header: 'Person', value: (i) => i.user.name },
  { header: 'Project', value: (i) => i.project.name },
  { header: 'Milestone', value: (i) => i.milestone.name },
  { header: 'Date', value: (i) => i.entry.work_date },
  { header: 'Hours', value: (i) => num(i.entry.hours) },
  { header: 'Status', value: (i) => i.label },
  { header: 'Overtime', value: (i) => Boolean(i.entry.over_40) },
  { header: 'Edited after a decision', value: (i) => Boolean(i.entry.edited_after_decision) },
  { header: 'Week logged total (hours)', value: (i) => num(i.week_logged_total) },
  { header: 'Note', value: (i) => i.entry.note },
]

export default function ApprovalsPage() {
  const [params, setParams] = useSearchParams()
  const filters = Object.fromEntries(['user', 'project', 'milestone'].map((k) => [k, params.get(k)]).filter(([, v]) => v))
  const approvals = useApprovals(filters)
  const leaving = useRedirectOnDenied(approvals.error)
  const items = approvals.data ?? []
  const groups = items.reduce((acc, item) => {
    const k = item.milestone.id
    if (!acc.has(k)) acc.set(k, { project: item.project, milestone: item.milestone, items: [] })
    acc.get(k).items.push(item)
    return acc
  }, new Map())
  if (leaving) return null

  return (
    <>
      <PageHeader title="Approvals" subtitle="Every logged hour needs your approval before it counts toward the project budget."
        actions={<>
          <ExportCsvButton name="approvals" columns={CSV_COLUMNS} rows={items} />
          {Object.keys(filters).length ? <Button onClick={() => setParams({})}>Show everyone</Button> : null}
        </>} />
      <ErrorAlert error={approvals.error} onRetry={() => approvals.refetch()} sx={{ mb: 2 }} />
      {approvals.isLoading ? <Skeleton variant="rounded" height={200} /> : null}
      {!approvals.isLoading && !approvals.error && items.length === 0 ? (
        <EmptyState title="Nothing waiting for approval" description="New hours from your team show up here." />
      ) : null}
      <Stack sx={{ gap: 2 }}>
        {[...groups.values()].map((g) => (
          <Paper key={g.milestone.id} variant="outlined" sx={{ px: 2, pt: 2, pb: 0.5 }}>
            <Typography variant="subtitle1" component="h2">{g.project.name} › {g.milestone.name}</Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>{g.items.length} waiting</Typography>
            {g.items.map((item) => <ApprovalRow key={item.entry.id} item={item} showContext={false} />)}
          </Paper>
        ))}
      </Stack>
    </>
  )
}
