import { Button, Paper, Skeleton, Stack, Typography } from '@mui/material'
import { useSearchParams } from 'react-router-dom'
import { useApprovals } from '../../api/queries.js'
import EmptyState from '../../components/EmptyState.jsx'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import PageHeader from '../../components/PageHeader.jsx'
import ApprovalRow from './ApprovalRow.jsx'

export default function ApprovalsPage() {
  const [params, setParams] = useSearchParams()
  const filters = Object.fromEntries(['user', 'project', 'milestone'].map((k) => [k, params.get(k)]).filter(([, v]) => v))
  const approvals = useApprovals(filters)
  const items = approvals.data ?? []
  const groups = items.reduce((acc, item) => {
    const k = item.milestone.id
    if (!acc.has(k)) acc.set(k, { project: item.project, milestone: item.milestone, items: [] })
    acc.get(k).items.push(item)
    return acc
  }, new Map())

  return (
    <>
      <PageHeader title="Approvals" subtitle="Every logged hour needs your approval before it counts toward the project budget."
        actions={Object.keys(filters).length ? <Button onClick={() => setParams({})}>Show everyone</Button> : null} />
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
