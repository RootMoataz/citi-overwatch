import FolderOff from '@mui/icons-material/FolderOffOutlined'
import { Box, ButtonBase, Paper, Skeleton, Stack, Typography } from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { PieChart } from '@mui/x-charts/PieChart'
import { useQuery } from '@tanstack/react-query'
import { Link as RouterLink } from 'react-router-dom'
import { api } from '../../api/client.js'
import { chartPalette } from '../../app/chartColors.js'
import CountUp from '../../components/CountUp.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import { formatPct } from '../../lib/format.js'
import { useCalmMotion } from '../../lib/motion.js'

// Under ['projects'] so creating, saving, archiving or restoring a project refreshes the counts too.
const useProjectStatusCounts = () => useQuery({
  queryKey: ['projects', 'status-counts'], queryFn: () => api.get('/projects/status-counts'),
})

/** Each bucket in reading order, with its colour (the same hue as its status chip: planned grey, active blue,
 * on hold amber, completed green; archived, which has no chip, takes the categorical violet) and where it leads. */
const BUCKETS = [
  { key: 'planned', label: 'Planned', color: (p) => p.reference, to: '/projects?status=planned' },
  { key: 'active', label: 'Active', color: (p) => p.ok, to: '/projects?status=active' },
  { key: 'on_hold', label: 'On hold', color: (p) => p.warning, to: '/projects?status=on_hold' },
  { key: 'completed', label: 'Completed', color: (p) => p.series[2], to: '/projects?status=completed' },
  { key: 'archived', label: 'Archived', color: (p) => p.series[6], to: '/archive?type=project' },
]

const projectsWord = (n) => (n === 1 ? 'project' : 'projects')
const share = (n, total) => formatPct(total ? (n / total) * 100 : 0)

/** The donut's key doubles as its numbers: every status with its count and share, each a link to that list. */
function StatusList({ rows, total }) {
  return (
    <Box component="ul" aria-label="Projects per status"
      sx={{ listStyle: 'none', p: 0, m: 0, display: 'grid', gap: 0.5, minWidth: 0, flex: 1, maxWidth: { sm: 440 }, width: '100%',
        alignSelf: 'stretch',
        alignContent: 'center' }}>
      {rows.map((r) => (
        <li key={r.key}>
          <ButtonBase component={RouterLink} to={r.to}
            aria-label={`${r.label}: ${r.value} ${projectsWord(r.value)}, ${share(r.value, total)}`}
            sx={{ width: '100%', justifyContent: 'flex-start', gap: 1, px: 1, py: 0.75, borderRadius: 1, textAlign: 'left',
              '&:hover': { bgcolor: 'action.hover' }, '&.Mui-focusVisible': { outline: 2, outlineColor: 'primary.main' } }}>
            <Box aria-hidden sx={{ width: 10, height: 10, borderRadius: '3px', bgcolor: r.color, flexShrink: 0 }} />
            <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }}>{r.label}</Typography>
            <Typography variant="body2" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
              <CountUp value={r.value} />
              <Typography component="span" variant="caption" sx={{ color: 'text.secondary', ml: 0.75 }}>
                · {share(r.value, total)}
              </Typography>
            </Typography>
          </ButtonBase>
        </li>
      ))}
    </Box>
  )
}

function StatusDonut({ rows, total }) {
  const calm = useCalmMotion()
  const slices = rows.filter((r) => r.value > 0)
  return (
    <Box sx={{ position: 'relative', width: 180, height: 180, flexShrink: 0 }} role="img"
      aria-label={`Donut chart: ${total} ${projectsWord(total)}. ${rows.map((r) => `${r.label} ${r.value}`).join(', ')}.`}>
      <PieChart width={180} height={180} hideLegend skipAnimation={calm} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
        colors={slices.map((r) => r.color)}
        series={[{ data: slices.map((r) => ({ id: r.key, label: r.label, value: r.value })),
          innerRadius: 58, outerRadius: 88, paddingAngle: slices.length > 1 ? 1.5 : 0, cornerRadius: 3,
          highlightScope: { fade: 'global', highlight: 'item' },
          valueFormatter: (d) => `${d.value} (${share(d.value, total)})` }]} />
      <Box aria-hidden sx={{ position: 'absolute', inset: 0, display: 'grid', placeContent: 'center', textAlign: 'center',
        pointerEvents: 'none' }}>
        <Typography sx={{ fontSize: '1.75rem', fontWeight: 700, lineHeight: 1.1 }}><CountUp value={total} /></Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>{projectsWord(total)}</Typography>
      </Box>
    </Box>
  )
}

/** Projects by status for admins and executives: every project once, archived ones counted on their own whatever
 * status they had. A donut with the total in the middle and a key that gives each count and share as text. */
export default function ProjectStatusCard() {
  const palette = chartPalette(useTheme())
  const counts = useProjectStatusCounts()
  let body
  if (counts.isLoading) {
    body = <Skeleton variant="rounded" height={180} sx={{ mt: 1 }} />
  } else if (counts.error) {
    body = <ErrorAlert error={counts.error} onRetry={() => counts.refetch()} />
  } else if (!counts.data.total) {
    body = <EmptyState icon={<FolderOff fontSize="inherit" />} title="No projects yet"
      description="Projects appear here by status once they are created." />
  } else {
    const rows = BUCKETS.map((b) => ({ ...b, value: Number(counts.data[b.key] ?? 0), color: b.color(palette) }))
    body = (
      <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ alignItems: 'center', gap: { xs: 2, sm: 4 }, mt: 1.5 }}>
        <StatusDonut rows={rows} total={counts.data.total} />
        <StatusList rows={rows} total={counts.data.total} />
      </Stack>
    )
  }
  return (
    <Paper variant="outlined" component="section" aria-labelledby="projects-by-status" sx={{ p: 2 }}>
      <Typography id="projects-by-status" variant="h3" component="h2">Projects by status</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>Every project, archived ones counted on their own</Typography>
      {body}
    </Paper>
  )
}
