import { Grid, Paper, Typography } from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { BarChart } from '@mui/x-charts/BarChart'
import { ChartsReferenceLine } from '@mui/x-charts/ChartsReferenceLine'
import { PieChart } from '@mui/x-charts/PieChart'
import { Fragment } from 'react'
import { categoryColors, chartColors } from '../../app/theme.js'
import PersonLink from '../../components/PersonLink.jsx'
import { formatHours } from '../../lib/format.js'

const WEEKLY_CAP = 40

/** Planned vs logged hours per person this week, with the 40h line. People over 40 get an orange bar, a ⚠ on
 * the axis, "(over 40h)" in the tooltip and their name in the note under the chart, so colour is never the only signal. */
function PeopleChart({ people }) {
  const palette = chartColors(useTheme())
  // Over 40h is a warning here (amber), not a red alarm.
  const COLORS = { planned: palette.planned, logged: palette.actual, over: palette.forecast }
  const isOver = (i) => Number(people[i].logged_total) > WEEKLY_CAP
  const over = people.filter((p) => Number(p.logged_total) > WEEKLY_CAP)
  const overIds = new Set(over.map((p) => String(p.user.id)))
  // The axis is keyed by id (two people can share a name) and shows the name.
  const nameOf = new Map(people.map((p) => [String(p.user.id), p.user.name]))
  return (
    <>
      <BarChart height={Math.max(160, people.length * 44 + 80)} layout="horizontal" borderRadius={4} grid={{ vertical: true }}
        yAxis={[{ scaleType: 'band', data: people.map((p) => String(p.user.id)), width: 140,
          valueFormatter: (id, ctx) => (ctx.location === 'tick' && overIds.has(id) ? `⚠ ${nameOf.get(id)}` : nameOf.get(id)) }]}
        xAxis={[{ label: 'Hours this week', valueFormatter: (v) => `${v}h` }]}
        series={[
          { data: people.map((p) => Number(p.planned_total)), label: 'Planned', color: COLORS.planned, valueFormatter: formatHours },
          { data: people.map((p) => Number(p.logged_total)), label: 'Logged', color: COLORS.logged,
            colorGetter: ({ dataIndex }) => (isOver(dataIndex) ? COLORS.over : COLORS.logged),
            valueFormatter: (v, { dataIndex }) => `${formatHours(v)}${isOver(dataIndex) ? ' (over 40h)' : ''}` },
        ]}
        margin={{ right: 40 }}>
        <ChartsReferenceLine x={WEEKLY_CAP} label="40h" labelAlign="start"
          lineStyle={{ strokeDasharray: '6 4', strokeWidth: 2 }} />
      </BarChart>
      <Typography role="note" variant="body2" sx={{ mt: 1, color: over.length ? 'warning.main' : 'text.secondary' }}>
        {over.length
          ? <>⚠ Over 40h this week: {over.map((p, i) => (
            <Fragment key={p.user.id}>{i ? '; ' : ''}<PersonLink person={p.user} context={{ managed: true }} color="inherit">
              {`${p.user.name} (${formatHours(p.logged_total)})`}</PersonLink></Fragment>
          ))}. Their logged bars are orange.</>
          : 'Nobody is over 40h this week.'}
      </Typography>
    </>
  )
}

/** Logged hours this week by project. Hours on projects someone has left fall under "Other projects". */
function ProjectPie({ people }) {
  const colors = categoryColors(useTheme())
  const byProject = new Map()
  let other = 0
  for (const person of people) {
    let counted = 0
    for (const p of person.projects) {
      const logged = Number(p.logged)
      counted += logged
      if (logged > 0) byProject.set(String(p.id), { label: p.name, value: (byProject.get(String(p.id))?.value ?? 0) + logged })
    }
    other += Math.max(Number(person.logged_total) - counted, 0)
  }
  const data = [...byProject.entries()].map(([id, d]) => ({ id, ...d }))
    .sort((a, b) => b.value - a.value)
  if (other > 0) data.push({ id: 'other', label: 'Other projects', value: other })
  if (!data.length) return <Typography variant="body2" sx={{ color: 'text.secondary' }}>No hours logged this week yet.</Typography>
  return (
    <PieChart height={240} colors={colors}
      series={[{ data, innerRadius: 50, paddingAngle: 1, cornerRadius: 3, valueFormatter: (d) => formatHours(d.value) }]} />
  )
}

export default function AllocationCharts({ people }) {
  return (
    <Grid container spacing={2} sx={{ mb: 2 }}>
      <Grid size={{ xs: 12, md: 8 }}>
        <Paper variant="outlined" sx={{ p: 2, height: '100%' }} component="section" aria-labelledby="chart-people">
          <Typography id="chart-people" variant="h3" component="h2">Planned vs logged this week</Typography>
          <PeopleChart people={people} />
        </Paper>
      </Grid>
      <Grid size={{ xs: 12, md: 4 }}>
        <Paper variant="outlined" sx={{ p: 2, height: '100%' }} component="section" aria-labelledby="chart-projects">
          <Typography id="chart-projects" variant="h3" component="h2">Logged hours by project</Typography>
          <ProjectPie people={people} />
        </Paper>
      </Grid>
    </Grid>
  )
}
