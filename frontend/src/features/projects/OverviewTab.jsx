import { Grid, Paper, Stack, Typography } from '@mui/material'
import { useProjectSummary } from '../../api/queries.js'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import PersonWithAvatar from '../../components/PersonWithAvatar.jsx'
import { RISK_LABELS, WORK_MODE } from '../../lib/labels.js'
import { formatDate, formatMoney, formatPct } from '../../lib/format.js'
import StatTile from './StatTile.jsx'

export default function OverviewTab({ project }) {
  const summary = useProjectSummary(project.id)
  const s = summary.data
  return (
    <Stack sx={{ gap: 3 }}>
      <ErrorAlert error={summary.error} onRetry={() => summary.refetch()} />
      <Grid container spacing={2}>
        <Grid size={{ xs: 6, md: 3 }}><StatTile label="Progress" value={formatPct(s?.progress_pct ?? project.progress_pct)}
          hint="Milestones done, weighted by difficulty" /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatTile label="Budget used" value={formatPct(s?.budget_pct ?? project.budget_pct)}
          hint={`${formatMoney(s?.consumed ?? project.consumed)} of ${formatMoney(project.budget)}`} /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatTile label="Team" value={s?.member_count ?? '—'} hint="people on this project" /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatTile label="Predicted end" value={formatDate(project.predicted_end_date)}
          hint={`Started ${formatDate(project.start_date)}`} /></Grid>
      </Grid>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h3" component="h2" sx={{ mb: 1 }}>About</Typography>
        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{project.description || 'No description yet.'}</Typography>
        <Typography variant="body2" component="div" sx={{ color: 'text.secondary', mt: 2, mb: 0.5 }}>
          Manager: <PersonWithAvatar person={project.manager} size={32} sx={{ ml: 0.5, color: 'text.primary' }} />
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>Department: {project.department?.name ?? 'None'}</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {WORK_MODE[project.work_mode ?? 'push'].label} mode: {WORK_MODE[project.work_mode ?? 'push'].help.toLowerCase()}
        </Typography>
      </Paper>
      {project.at_risk_reasons.length ? (
        <Paper variant="outlined" sx={{ p: 2, borderColor: 'warning.main' }}>
          <Typography variant="h3" component="h2" sx={{ mb: 1 }}>Why it's at risk</Typography>
          <Stack component="ul" sx={{ m: 0, pl: 3 }}>
            {project.at_risk_reasons.map((r) => <Typography component="li" variant="body2" key={r}>{RISK_LABELS[r] ?? r}</Typography>)}
          </Stack>
        </Paper>
      ) : null}
    </Stack>
  )
}
