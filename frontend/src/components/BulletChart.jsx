import { Box, Link, Stack, Tooltip, Typography } from '@mui/material'
import { keyframes, useTheme } from '@mui/material/styles'
import { Link as RouterLink } from 'react-router-dom'
import { chartPalette, TONE_TEXT } from '../app/chartColors.js'

const grow = keyframes`from { transform: scaleX(0) } to { transform: scaleX(1) }`
const BAR = 12
const LANE = 22
const clampPct = (value, max) => Math.min(Math.max((Number(value) / max) * 100, 0), 100)

/** One legend key: what a bar, a track, a marker or a reference line means. */
function Key({ kind, label, color, palette }) {
  const swatch = {
    bar: { width: 14, height: 8, borderRadius: '0 3px 3px 0', bgcolor: color },
    track: { width: 14, height: 12, borderRadius: '2px', bgcolor: color },
    marker: { width: 3, height: 14, bgcolor: palette.marker, borderRadius: 1 },
    reference: { width: 0, height: 14, borderLeft: `2px dashed ${palette.reference}` },
  }[kind]
  return (
    <Stack component="li" direction="row" sx={{ alignItems: 'center', gap: 0.75 }}>
      <Box aria-hidden sx={{ flexShrink: 0, ...swatch }} />
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>{label}</Typography>
    </Stack>
  )
}

/**
 * A horizontal bullet chart, one row per item: a ghost track (the target or the plan), the measured bar on top, an
 * optional marker (a forecast) and dashed reference lines (a 40h cap). Each row carries its own label and value as
 * text, so nothing is clipped at any width and colour is never the only signal; hovering or focusing a row shows the
 * exact numbers.
 *
 * rows: [{ id, label, href?, value, track?, marker?, tone: 'ok'|'warning'|'alert', valueText, detail?, summary }]
 * `href` turns the row's label into a link (e.g. to the project).
 * legend: [{ kind: 'bar'|'track'|'marker'|'reference', label, tone? , trackColor? }]
 */
export default function BulletChart({ rows, max, ticks, tickFormat, axisLabel, references = [], legend = [], ariaLabel,
  track = 'track' }) {
  const palette = chartPalette(useTheme())
  const trackColor = palette[track]
  const legendColor = (item) => (item.kind === 'track' ? trackColor : palette[item.tone ?? 'ok'])
  return (
    <Box>
      {legend.length ? (
        <Stack component="ul" direction="row" useFlexGap aria-label="Legend"
          sx={{ listStyle: 'none', p: 0, m: 0, mb: 1.5, gap: { xs: 1, sm: 2 }, flexWrap: 'wrap' }}>
          {legend.map((item) => <Key key={item.label} {...item} color={legendColor(item)} palette={palette} />)}
        </Stack>
      ) : null}
      <Box component="ul" aria-label={ariaLabel} sx={{ listStyle: 'none', p: 0, m: 0, display: 'grid', gap: 1.25 }}>
        {rows.map((row, index) => (
          <Tooltip key={row.id} title={<Box sx={{ whiteSpace: 'pre-line' }}>{row.summary}</Box>} placement="top" followCursor>
            <Box component="li" tabIndex={0} aria-label={row.summary.replace(/\n/g, '. ')}
              sx={{ outline: 'none', borderRadius: 1, px: 0.5, mx: -0.5, py: 0.25,
                '&:hover, &:focus-visible': { bgcolor: 'action.hover' },
                '&:focus-visible': { boxShadow: (t) => `0 0 0 2px ${t.palette.primary.main}` } }}>
              <Stack direction="row" sx={{ alignItems: 'baseline', gap: 1, minWidth: 0 }}>
                <Typography variant="body2" noWrap aria-hidden={row.href ? undefined : true}
                  sx={{ fontWeight: 600, flex: 1, minWidth: 0 }}>
                  {row.href
                    ? <Link component={RouterLink} to={row.href} underline="hover" aria-label={`Open ${row.label}`}>{row.label}</Link>
                    : row.label}
                </Typography>
                <Typography variant="body2" aria-hidden sx={{ flexShrink: 0, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
                  color: TONE_TEXT[row.tone] ?? 'text.primary' }}>
                  {row.valueText}
                </Typography>
              </Stack>
              <Box aria-hidden sx={{ position: 'relative', height: LANE, my: 0.25 }}>
                {ticks.map((t) => (
                  <Box key={t} sx={{ position: 'absolute', top: 0, bottom: 0, left: `${clampPct(t, max)}%`, width: '1px',
                    bgcolor: 'divider' }} />
                ))}
                {row.track != null ? (
                  <Box sx={{ position: 'absolute', left: 0, top: 2, bottom: 2, width: `${clampPct(row.track, max)}%`,
                    bgcolor: trackColor, borderRadius: '0 4px 4px 0' }} />
                ) : null}
                {row.value != null ? (
                  <Box sx={{ position: 'absolute', left: 0, top: (LANE - BAR) / 2, height: BAR,
                    width: `${clampPct(row.value, max)}%`, minWidth: Number(row.value) > 0 ? 3 : 0,
                    bgcolor: palette[row.tone] ?? palette.ok, borderRadius: '0 4px 4px 0', transformOrigin: 'left',
                    animation: `${grow} 600ms ${index * 40}ms cubic-bezier(.2,.7,.2,1) both` }} />
                ) : null}
                {references.map((r) => (
                  <Box key={r.label} sx={{ position: 'absolute', top: -2, bottom: -2, left: `${clampPct(r.value, max)}%`,
                    borderLeft: `2px dashed ${palette.reference}`, transform: 'translateX(-1px)' }} />
                ))}
                {row.marker != null ? (
                  <Box sx={{ position: 'absolute', top: 0, bottom: 0, left: `${clampPct(row.marker, max)}%`, width: 3,
                    transform: 'translateX(-1.5px)', bgcolor: palette.marker, borderRadius: 1,
                    boxShadow: (t) => `0 0 0 2px ${t.palette.background.paper}` }} />
                ) : null}
              </Box>
              {row.detail ? (
                <Typography variant="caption" component="p" aria-hidden sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
                  {row.detail}
                </Typography>
              ) : null}
            </Box>
          </Tooltip>
        ))}
      </Box>
      <Box aria-hidden sx={{ position: 'relative', height: 18, mt: 0.5, mx: 0, borderTop: 1, borderColor: 'divider' }}>
        {ticks.map((t, i) => (
          <Typography key={t} variant="caption" sx={{ position: 'absolute', top: 2, left: `${clampPct(t, max)}%`,
            transform: i === 0 ? 'none' : i === ticks.length - 1 && clampPct(t, max) >= 99 ? 'translateX(-100%)' : 'translateX(-50%)',
            color: 'text.secondary', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', lineHeight: 1.4,
            // Phones keep every other label when there are many, so they never collide.
            display: ticks.length > 5 && i % 2 ? { xs: 'none', sm: 'block' } : 'block' }}>
            {tickFormat(t)}
          </Typography>
        ))}
      </Box>
      {axisLabel ? (
        <Typography variant="caption" component="p" aria-hidden sx={{ textAlign: 'center', color: 'text.secondary', mt: 0.5 }}>
          {axisLabel}
        </Typography>
      ) : null}
    </Box>
  )
}
