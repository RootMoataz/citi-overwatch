import { Box, Link, Skeleton, Stack, Typography } from '@mui/material'
import { Link as RouterLink } from 'react-router-dom'
import { useApprovals } from '../../api/queries.js'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import PersonLink from '../../components/PersonLink.jsx'
import UserAvatar from '../../components/UserAvatar.jsx'
import { formatDayLabel, formatHours } from '../../lib/format.js'
import Section from '../dashboard/Section.jsx'

const SHOWN = 3

/** A manager's approvals queue, pinned to the top of their home: how many entries wait and the oldest few. */
export default function ApprovalsPanel() {
  const approvals = useApprovals({})
  const items = approvals.data ?? []
  const count = items.length
  return (
    <Section question="Approvals" action={<Link component={RouterLink} to="/approvals">Review all</Link>}>
      <ErrorAlert error={approvals.error} onRetry={() => approvals.refetch()} />
      {approvals.isLoading ? <Skeleton variant="rounded" height={72} /> : count ? (
        <Stack direction={{ xs: 'column', md: 'row' }} sx={{ gap: { xs: 1.5, md: 3 }, alignItems: { md: 'flex-start' } }}>
          <Box sx={{ flexShrink: 0, minWidth: 160 }}>
            <Typography variant="h2" component="p" sx={{ color: 'warning.main' }}>{count}</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>{`${count} ${count === 1 ? 'entry' : 'entries'} waiting`}</Typography>
          </Box>
          <Box component="ul" aria-label="Oldest pending entries" sx={{ listStyle: 'none', p: 0, m: 0, flexGrow: 1, minWidth: 0 }}>
            {items.slice(0, SHOWN).map((item) => (
              <Box component="li" key={item.entry.id}
                sx={{ py: 1, borderTop: 1, borderColor: 'divider', '&:first-of-type': { borderTop: 0, pt: 0 } }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  <UserAvatar userId={item.user.id} name={item.user.name}
                    sx={{ display: 'inline-flex', verticalAlign: 'middle', mr: 1 }} />
                  <PersonLink person={item.user} context={{ managed: true }} /> · {formatDayLabel(item.entry.work_date)} · {formatHours(item.entry.hours)}
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary', overflowWrap: 'anywhere' }}>
                  {item.project.name} › {item.milestone.name}
                </Typography>
              </Box>
            ))}
            {count > SHOWN ? (
              <Typography component="li" variant="body2" sx={{ pt: 1, color: 'text.secondary' }}>
                and {count - SHOWN} more on the <Link component={RouterLink} to="/approvals">approvals page</Link>
              </Typography>
            ) : null}
          </Box>
        </Stack>
      ) : <Typography variant="body2" sx={{ color: 'text.secondary' }}>Nothing waiting for approval. You're all caught up.</Typography>}
    </Section>
  )
}
