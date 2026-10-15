import { Box, Grid, Paper, Stack, Typography } from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { PieChart } from '@mui/x-charts/PieChart'
import { Fragment } from 'react'
import { chartPalette } from '../../app/chartColors.js'
import BulletChart from '../../components/BulletChart.jsx'
import PersonLink from '../../components/PersonLink.jsx'
import { allocationRows, hoursByProject, hoursForm, niceMax, ticksTo, WEEKLY_CAP } from '../../lib/chartData.js'
import { formatHours, formatPct } from '../../lib/format.js'

/** Logged hours per person this week (the bar) against what was planned (the ghost behind it) and the 40h cap
 * (dashed), busiest first. Over 40h is red, marked ⚠ in the row and named, with a link, in the note under the chart. */
function PeopleChart({ people }) {
  const rows = allocationRows(people)
  const over = rows.filter((r) => r.over)
  const max = niceMax(Math.max(WEEKLY_CAP + 5, ...rows.map((r) => Math.max(r.logged, r.planned))), 10)
  return (
    <>
      <BulletChart ariaLabel="Logged and planned hours per person" track="ghost" max={max} ticks={ticksTo(max, 10)}
        tickFormat={(v) => `${v}h`} axisLabel="Hours this week" references={[{ value: WEEKLY_CAP, label: '40h' }]}
        legend={[{ kind: 'bar', label: 'Logged' }, { kind: 'track', label: 'Planned' },
          { kind: 'reference', label: '40h week' }, ...(over.length ? [{ kind: 'bar', tone: 'alert', label: 'Over 40h' }] : [])]}
        rows={rows.map((r) => ({
          id: r.id, label: `${r.over ? '⚠ ' : ''}${r.name}`, tone: r.tone, value: r.logged, track: r.planned,
          valueText: `${formatHours(r.logged)} · plan ${formatHours(r.planned)}`,
          summary: `${r.name}\nLogged ${formatHours(r.logged)}${r.over ? ' (over 40h)' : ''}\nPlanned ${formatHours(r.planned)}`,
        }))} />
      <Typography role="note" variant="body2" sx={{ mt: 1.5, color: over.length ? 'error.main' : 'text.secondary' }}>
        {over.length
          ? <>⚠ Over 40h this week: {over.map((r, i) => (
            <Fragment key={r.id}>{i ? '; ' : ''}<PersonLink person={r.user} context={{ managed: true }} color="inherit">
              {`${r.name} (${formatHours(r.logged)})`}</PersonLink></Fragment>
          ))}.</>
          : 'Nobody is over 40h this week.'}
      </Typography>
    </>
  )
}

/** The donut's key doubles as its labels: every slice's name, hours and share as text. */
function SliceList({ data, colors, total }) {
  return (
    <Box component="ul" aria-label="Hours per project"
      sx={{ listStyle: 'none', p: 0, m: 0, display: 'grid', gap: 0.75, minWidth: 0, flex: 1, alignSelf: 'stretch' }}>
      {data.map((d, i) => (
        <Stack component="li" key={d.id} direction="row" sx={{ alignItems: 'center', gap: 1, minWidth: 0 }}
          title={d.label}>
          <Box aria-hidden sx={{ width: 10, height: 10, borderRadius: '3px', bgcolor: colors[i], flexShrink: 0 }} />
          <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }}>{d.label}</Typography>
          <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
            {formatHours(d.value)}
            <Typography component="span" variant="caption" sx={{ color: 'text.secondary', ml: 0.75 }}>
              {formatPct((d.value / total) * 100)}
            </Typography>
          </Typography>
        </Stack>
      ))}
    </Box>
  )
}

/** Logged hours this week by project: a donut with the total in the middle while there are five slices or fewer,
 * otherwise bars (too many slices can't be compared by angle). */
function ProjectHours({ people }) {
  const palette = chartPalette(useTheme())
  const data = hoursByProject(people)
  if (!data.length) return <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1 }}>No hours logged this week yet.</Typography>
  const total = data.reduce((sum, d) => sum + d.value, 0)
  if (hoursForm(data) === 'bars') {
    const max = niceMax(data[0].value, 10)
    return (
      <Box sx={{ mt: 1 }}>
        <BulletChart ariaLabel="Logged hours per project" max={max} ticks={ticksTo(max, max > 60 ? 20 : 10)}
          tickFormat={(v) => `${v}h`} axisLabel={`Hours this week · ${formatHours(total)} in total`}
          rows={data.map((d) => ({ id: d.id, label: d.label, tone: 'ok', value: d.value,
            valueText: `${formatHours(d.value)} · ${formatPct((d.value / total) * 100)}`,
            summary: `${d.label}\n${formatHours(d.value)} logged (${formatPct((d.value / total) * 100)} of ${formatHours(total)})` }))} />
      </Box>
    )
  }
  const colors = data.map((d, i) => (d.id === 'other' ? palette.reference : palette.series[i]))
  return (
    <Stack direction={{ xs: 'column', sm: 'row', md: 'column' }} sx={{ alignItems: 'center', gap: 2, mt: 1 }}>
      <Box sx={{ position: 'relative', width: 180, height: 180, flexShrink: 0 }}
        role="img" aria-label={`Donut chart: ${formatHours(total)} logged this week. ${data.map((d) => `${d.label} ${formatHours(d.value)}`).join(', ')}.`}>
        <PieChart width={180} height={180} hideLegend margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
          colors={colors}
          series={[{ data, innerRadius: 58, outerRadius: 88, paddingAngle: 1.5, cornerRadius: 3,
            highlightScope: { fade: 'global', highlight: 'item' },
            valueFormatter: (d) => `${formatHours(d.value)} (${formatPct((d.value / total) * 100)})` }]} />
        <Box aria-hidden sx={{ position: 'absolute', inset: 0, display: 'grid', placeContent: 'center', textAlign: 'center',
          pointerEvents: 'none' }}>
          <Typography sx={{ fontSize: '1.5rem', fontWeight: 700, lineHeight: 1.1 }}>{formatHours(total)}</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>logged</Typography>
        </Box>
      </Box>
      <SliceList data={data} colors={colors} total={total} />
    </Stack>
  )
}

export default function AllocationCharts({ people }) {
  return (
    <Grid container spacing={2} sx={{ mb: 2 }}>
      <Grid size={{ xs: 12, md: 8 }}>
        <Paper variant="outlined" sx={{ p: 2, height: '100%' }} component="section" aria-labelledby="chart-people">
          <Typography id="chart-people" variant="h3" component="h2">Planned vs logged this week</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }}>Hours per person, busiest first</Typography>
          <PeopleChart people={people} />
        </Paper>
      </Grid>
      <Grid size={{ xs: 12, md: 4 }}>
        <Paper variant="outlined" sx={{ p: 2, height: '100%' }} component="section" aria-labelledby="chart-projects">
          <Typography id="chart-projects" variant="h3" component="h2">Logged hours by project</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>Every person's logged hours, by project</Typography>
          <ProjectHours people={people} />
        </Paper>
      </Grid>
    </Grid>
  )
}
