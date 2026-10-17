import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import { Box, ButtonBase, Paper, Stack, Typography } from '@mui/material'
import { useId } from 'react'
import { tonalFill } from '../../app/theme.js'

/**
 * A dashboard panel titled with the business question it answers (a labelled region for screen readers).
 * Opt-in `collapsible` mode (controlled by `open` / `onToggle`) turns the title into a disclosure button;
 * the body stays in the DOM, `hidden` and empty while collapsed.
 */
export default function Section({
  question, hint, action, children, collapsible = false, open = true, onToggle, buttonLabel, id,
}) {
  const headingId = useId()
  const bodyId = useId()
  return (
    <Paper component="section" id={id} variant="outlined" aria-labelledby={headingId} sx={{ p: 2, height: '100%' }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 1, mb: 1.5 }}>
        <Typography id={headingId} variant="h3" component="h2" sx={collapsible ? { flex: 1, minWidth: 0 } : undefined}>
          {collapsible ? (
            <ButtonBase
              onClick={() => onToggle?.()}
              aria-expanded={open}
              aria-controls={bodyId}
              aria-label={buttonLabel ?? question}
              sx={(theme) => ({
                ...tonalFill(theme, theme.palette.primary.main),
                font: 'inherit', color: 'inherit', textAlign: 'left', minHeight: 44, gap: 0.5,
                alignItems: 'center', justifyContent: 'flex-start', borderRadius: 1, width: '100%', px: 1,
              })}
            >
              <ExpandMoreIcon
                aria-hidden="true"
                fontSize="small"
                sx={{ transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform 150ms', flexShrink: 0 }}
              />
              <span>{question}</span>
            </ButtonBase>
          ) : question}
        </Typography>
        {action ? <Box sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}>{action}</Box> : null}
      </Stack>
      {hint ? <Typography variant="body2" sx={{ color: 'text.secondary', mt: -1, mb: 1.5 }}>{hint}</Typography> : null}
      {collapsible ? <div id={bodyId} hidden={!open}>{open ? children : null}</div> : children}
    </Paper>
  )
}
