import { useId } from 'react'
import { Box, ButtonBase, LinearProgress, Paper, Skeleton, Tooltip, Typography } from '@mui/material'
import { useMediaQuery } from 'react-responsive'
import { formatPct } from '../lib/format.js'
import { DESKTOP_QUERY } from '../lib/responsive.js'
import ErrorAlert from './ErrorAlert.jsx'

const BAR_COLOUR = { ok: 'primary', warning: 'warning', alert: 'error', error: 'error' }

function Item({ item, layout, divider }) {
  const toneColour = item.tone ? `${item.tone}.main` : 'text.primary'
  const label = (
    <Typography variant="body2" component="span" sx={{ color: 'text.secondary', fontWeight: 600, display: 'block' }}>
      {item.label}
      {item.info && !item.onClick ? (
        <Tooltip title={item.info}>
          <Box component="span" tabIndex={0} role="img" aria-label={item.info} sx={{ ml: 0.5, cursor: 'help' }}>ⓘ</Box>
        </Tooltip>
      ) : null}
    </Typography>
  )
  const value = (
    <Typography variant="h2" component="span" sx={{ display: 'block', fontSize: '1.5rem', letterSpacing: '-0.01em',
      color: toneColour, fontVariantNumeric: 'tabular-nums' }}>{item.value}</Typography>
  )
  const body = (
    <>
      {layout === 'value-first' ? <>{value}{label}</> : <>{label}{value}</>}
      {item.bar ? (
        <LinearProgress variant="determinate" value={Math.min(Math.max(Number(item.bar.value ?? 0), 0), 100)}
          color={BAR_COLOUR[item.bar.tone] ?? 'primary'} aria-label={item.bar.label}
          aria-valuetext={formatPct(item.bar.value)} sx={{ mt: 1, height: 8, borderRadius: 4 }} />
      ) : null}
      {item.hint ? (
        <Typography variant="caption" component="span" sx={{ display: 'block', color: 'text.secondary', mt: 0.5 }}>
          {item.hint}
        </Typography>
      ) : null}
      {item.icon ? (
        <Box aria-hidden sx={{ position: 'absolute', top: 12, right: 12, display: 'grid', placeItems: 'center',
          color: item.tone ? `${item.tone}.main` : 'primary.main', '& svg': { fontSize: 20 } }}>{item.icon}</Box>
      ) : null}
    </>
  )
  const sx = { position: 'relative', display: 'block', width: '100%', height: '100%', textAlign: 'left', p: 2,
    bgcolor: 'background.paper', minHeight: 44, ...divider }
  if (item.onClick) {
    return (
      <ButtonBase data-tone={item.tone} onClick={item.onClick} aria-label={`${item.value} ${item.label}`}
        sx={{ ...sx, '&:hover': { bgcolor: 'action.hover' },
          '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 } }}>{body}</ButtonBase>
    )
  }
  return <Box data-tone={item.tone} sx={sx}>{body}</Box>
}

/**
 * One outlined card of figures with dividers between them. An item with `onClick` is a button named "<value> <label>";
 * `bar` adds a determinate bar; `error` replaces the figures with an alert and Retry. `title` puts an H2 inside the card
 * above the figures and names the group by it (in place of `ariaLabel`).
 */
export default function KpiStrip({ ariaLabel, title, items, layout = 'label-first', phoneColumns = 2, loading = false, error, onRetry }) {
  const desktop = useMediaQuery(DESKTOP_QUERY)
  const titleId = useId()
  const frame = title ? { 'aria-labelledby': titleId } : { 'aria-label': ariaLabel }
  const heading = title ? (
    <Typography id={titleId} variant="h3" component="h2" sx={{ px: 2, pt: 2, pb: 0.5, bgcolor: 'background.paper' }}>{title}</Typography>
  ) : null
  if (error) {
    // Items marked `keepOnError` still show beside the alert (the Overview's Progress, which the project itself carries).
    const kept = items.filter((item) => item.keepOnError)
    return (
      <Paper variant="outlined" role="group" {...frame} sx={{ overflow: 'hidden' }}>
        {heading}
        <Box sx={{ display: 'grid', gridTemplateColumns: kept.length && desktop ? `repeat(${kept.length}, 1fr) 3fr` : '1fr' }}>
          {kept.map((item, i) => <Item key={item.key ?? item.label} item={item} layout={layout}
            divider={!desktop && i ? { borderTop: 1, borderColor: 'divider' } : null} />)}
          <Box sx={{ p: 1.5, ...(kept.length ? { borderLeft: desktop ? 1 : 0, borderTop: desktop ? 0 : 1, borderColor: 'divider' } : null) }}>
            <ErrorAlert error={error} onRetry={onRetry} />
          </Box>
        </Box>
      </Paper>
    )
  }
  const columns = desktop ? Math.max(items.length, 1) : phoneColumns
  // Dividers are borders on the cells, so a short last row leaves its empty space untinted.
  const dividerFor = (i) => ({ ...(i % columns ? { borderLeft: 1, borderColor: 'divider' } : null),
    ...(i >= columns ? { borderTop: 1, borderColor: 'divider' } : null) })
  return (
    <Paper variant="outlined" role="group" {...frame} aria-busy={loading || undefined} sx={{ overflow: 'hidden' }}>
      {heading}
      <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
        {loading
          ? Array.from({ length: Math.max(items.length, columns) }, (_, i) => (
            <Box key={i} sx={{ p: 2, bgcolor: 'background.paper', ...dividerFor(i) }}><Skeleton width="60%" /><Skeleton width="40%" height={36} /></Box>
          ))
          : items.map((item, i) => <Item key={item.key ?? item.label} item={item} layout={layout} divider={dividerFor(i)} />)}
      </Box>
    </Paper>
  )
}
