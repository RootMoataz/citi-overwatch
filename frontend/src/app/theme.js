import { createTheme } from '@mui/material/styles'

export const BRAND = '#0B5CAD'

/** One label + color per status, shared by chips, charts and the timeline. Never color alone. */
export const STATUS = {
  planned: { label: 'Planned', color: '#5B6B7F' },
  active: { label: 'Active', color: '#0B5CAD' },
  on_hold: { label: 'On hold', color: '#B26A00' },
  completed: { label: 'Completed', color: '#1E7D45' },
  not_started: { label: 'Not started', color: '#5B6B7F' },
  in_progress: { label: 'In progress', color: '#0B5CAD' },
  ready_for_review: { label: 'Ready for review', color: '#6B3FA0' },
  blocked: { label: 'Blocked', color: '#B3261E' },
  pending: { label: 'Pending approval', color: '#B26A00' },
  approved: { label: 'Approved', color: '#1E7D45' },
  rejected: { label: 'Rejected', color: '#B3261E' },
}

export function buildTheme(mode = 'light') {
  const dark = mode === 'dark'
  return createTheme({
    palette: {
      mode,
      primary: { main: dark ? '#5AA2F0' : BRAND },
      secondary: { main: '#00897B' },
      error: { main: '#B3261E' },
      warning: { main: '#B26A00' },
      success: { main: '#1E7D45' },
      background: dark ? { default: '#0F1720', paper: '#16212C' } : { default: '#F4F6F9', paper: '#FFFFFF' },
      divider: dark ? 'rgba(255,255,255,0.12)' : '#E3E8EF',
      text: dark ? undefined : { primary: '#16212C', secondary: '#4A5869' },
    },
    shape: { borderRadius: 8 },
    spacing: 8,
    typography: {
      fontFamily: '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      h1: { fontSize: '1.75rem', fontWeight: 700, letterSpacing: '-0.01em' },
      h2: { fontSize: '1.375rem', fontWeight: 700 },
      h3: { fontSize: '1.125rem', fontWeight: 600 },
      subtitle1: { fontWeight: 600 },
      button: { textTransform: 'none', fontWeight: 600 },
    },
    components: {
      MuiButton: { defaultProps: { disableElevation: true } },
      MuiPaper: { defaultProps: { elevation: 0 } },
      MuiCard: { defaultProps: { variant: 'outlined' } },
      MuiTextField: { defaultProps: { fullWidth: true, size: 'small' } },
      MuiChip: { styleOverrides: { root: { fontWeight: 600 } } },
      MuiTooltip: { defaultProps: { arrow: true } },
    },
  })
}
