import ErrorOutline from '@mui/icons-material/ErrorOutlineOutlined'
import InfoOutlined from '@mui/icons-material/InfoOutlined'
import Lightbulb from '@mui/icons-material/LightbulbOutlined'
import WarningAmber from '@mui/icons-material/WarningAmber'
import { Box, Chip, Link, List, ListItem, Skeleton, Stack, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { Link as RouterLink } from 'react-router-dom'
import { api } from '../../api/client.js'
import EmptyState from '../../components/EmptyState.jsx'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import Section from './Section.jsx'

// Under the 'dashboard' key, so anything that refreshes the dashboard (approvals, project edits) refreshes these too.
const useSmartInsights = (department) => useQuery({
  queryKey: ['dashboard', 'smart', department], queryFn: () => api.get('/insights/smart', { department }),
})

const SEVERITY = {
  high: { label: 'High Severity', color: 'error', Icon: ErrorOutline },
  medium: { label: 'Medium Severity', color: 'warning', Icon: WarningAmber },
  low: { label: 'Low Severity', color: 'info', Icon: InfoOutlined },
}

function target(link) {
  if (link.to === 'project') return { to: `/projects/${link.id}${link.tab ? `?tab=${link.tab}` : ''}`, label: 'Open project' }
  if (link.to === 'person') return { to: `/people/${link.id}/profile`, label: 'View profile' }
  return { to: '/timesheets', label: 'Review approvals' }
}

function InsightRow({ insight }) {
  const { label, color, Icon } = SEVERITY[insight.severity] ?? SEVERITY.low
  const { to, label: action } = target(insight.link)
  return (
    <ListItem disableGutters alignItems="flex-start" sx={{ gap: 1.5, borderTop: 1, borderColor: 'divider', py: 1.25 }}>
      <Box aria-hidden sx={{ color: `${color}.main`, pt: 0.25 }}><Icon /></Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" useFlexGap sx={{ alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography variant="subtitle2" component="h3">{insight.title}</Typography>
          <Chip size="small" variant="outlined" color={color} label={label} />
        </Stack>
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.25 }}>{insight.detail}</Typography>
        <Link component={RouterLink} to={to} underline="hover" variant="body2">{action}</Link>
      </Box>
    </ListItem>
  )
}

/** Rule-based suggestions (no AI): ranked by severity, at most six, each linking to where to act.
 *  `department` (an id, or '' for all) narrows them like the rest of the dashboard. */
export default function SmartInsightsPanel({ department = '' }) {
  const insights = useSmartInsights(department)
  let body
  if (insights.isLoading) body = <Skeleton variant="rounded" height={120} />
  else if (insights.error) body = <ErrorAlert error={insights.error} onRetry={() => insights.refetch()} />
  else if (!insights.data.length) {
    body = <EmptyState icon={<Lightbulb fontSize="inherit" />} title="No suggestions right now"
      description="Nothing in your projects or team needs attention." />
  } else {
    body = (
      <List disablePadding aria-label="Suggestions">
        {insights.data.map((i) => <InsightRow key={i.id} insight={i} />)}
      </List>
    )
  }
  return <Section question="Smart insights" hint="Rule-based suggestions from your live data">{body}</Section>
}
