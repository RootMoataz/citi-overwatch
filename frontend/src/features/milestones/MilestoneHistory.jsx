import { Box, Chip, Paper, Skeleton, Stack, Typography } from '@mui/material'
import { useMilestoneHistory } from '../../api/workflow.js'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import { relativeTime } from '../../lib/relativeTime.js'

const RESOLUTION = { returned: 'Returned to the team', requeued: 'Put back in the queue' }

function Kickback({ k }) {
  return (
    <Paper variant="outlined" component="li" sx={{ p: 1.5, listStyle: 'none' }}>
      <Stack direction="row" useFlexGap sx={{ gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>{k.category_label}</Typography>
        <Chip size="small" variant="outlined" color={k.resolution ? 'success' : 'error'}
          label={k.resolution ? RESOLUTION[k.resolution] : 'Waiting for review'} />
      </Stack>
      <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{k.reason}</Typography>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        Raised by {k.raised_by.name} · {relativeTime(k.raised_at)}
      </Typography>
      {k.resolution ? (
        <Box sx={{ mt: 1, pl: 1.5, borderLeft: 3, borderColor: 'success.main' }}>
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{k.resolution_note}</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {k.resolved_by.name} · {relativeTime(k.resolved_at)}
          </Typography>
        </Box>
      ) : null}
    </Paper>
  )
}

/** Everything that happened to a milestone: kickbacks with their resolutions, then status, assignment (manual,
 * claimed, auto-routed) and edit events from the audit trail. */
export default function MilestoneHistory({ milestone }) {
  const history = useMilestoneHistory(milestone.id)
  const kickbacks = history.data?.kickbacks ?? []
  const events = history.data?.events ?? []
  return (
    <Box component="section" aria-label={`History of ${milestone.name}`} sx={{ mt: 1.5 }}>
      <Typography variant="subtitle2" component="h4" sx={{ mb: 1 }}>History</Typography>
      <ErrorAlert error={history.error} onRetry={() => history.refetch()} />
      {history.isLoading ? <Skeleton variant="rounded" height={64} /> : null}
      {kickbacks.length ? (
        <Stack component="ul" aria-label="Kickbacks" sx={{ gap: 1, p: 0, m: 0, mb: 1.5 }}>
          {kickbacks.map((k) => <Kickback key={k.id} k={k} />)}
        </Stack>
      ) : null}
      {history.data && !events.length ? (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>Nothing recorded yet.</Typography>
      ) : null}
      {events.length ? (
        <Box component="ol" aria-label="Events" sx={{ listStyle: 'none', p: 0, m: 0 }}>
          {events.map((e) => (
            <Box component="li" key={e.id} sx={{ py: 0.5, borderTop: 1, borderColor: 'divider', '&:first-of-type': { borderTop: 0 } }}>
              <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{e.sentence}</Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                <time dateTime={e.created_at} title={new Date(e.created_at).toLocaleString()}>{relativeTime(e.created_at)}</time>
              </Typography>
            </Box>
          ))}
        </Box>
      ) : null}
    </Box>
  )
}
