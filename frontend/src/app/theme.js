import { alpha, createTheme } from '@mui/material/styles'

export const BRAND = '#0B5CAD'

// Lighter tones of the same hues for dark surfaces, where the light-theme colours are too dark to read.
const TONE = { grey: '#9AA9BA', blue: '#6CB0F5', amber: '#F2A950', green: '#5DC78C', purple: '#B99AE8', red: '#F28B82' }

/** One label + color per status, shared by chips, charts and the timeline; `dark` is the colour on dark surfaces.
 * Never color alone. Pick the right one with statusColor(). */
export const STATUS = {
  planned: { label: 'Planned', color: '#5B6B7F', dark: TONE.grey },
  active: { label: 'Active', color: '#0B5CAD', dark: TONE.blue },
  on_hold: { label: 'On hold', color: '#B26A00', dark: TONE.amber },
  completed: { label: 'Completed', color: '#1E7D45', dark: TONE.green },
  not_started: { label: 'Not started', color: '#5B6B7F', dark: TONE.grey },
  in_progress: { label: 'In progress', color: '#0B5CAD', dark: TONE.blue },
  ready_for_review: { label: 'Ready for review', color: '#6B3FA0', dark: TONE.purple },
  // Kicked back by an assignee; only its manager's review moves it on.
  blocked: { label: 'Blocked – needs review', color: '#B3261E', dark: TONE.red },
  // Computed, never stored: a predecessor isn't completed yet.
  waiting: { label: 'Waiting on dependencies', color: '#5B6B7F', dark: TONE.grey },
  pending: { label: 'Pending approval', color: '#B26A00', dark: TONE.amber },
  approved: { label: 'Approved', color: '#1E7D45', dark: TONE.green },
  rejected: { label: 'Rejected', color: '#B3261E', dark: TONE.red },
}

/** A status's colour for the current theme (`theme` or a palette mode). Unknown statuses are grey. */
export function statusColor(meta, themeOrMode) {
  const mode = typeof themeOrMode === 'string' ? themeOrMode : themeOrMode?.palette?.mode
  const m = meta ?? STATUS.planned
  return mode === 'dark' ? (m.dark ?? m.color) : m.color
}

// Chart colours (series, ok / warning / alert, tracks and markers) live in chartColors.js.

export function buildTheme(mode = 'light') {
  const dark = mode === 'dark'
  const primary = dark ? '#5AA2F0' : BRAND
  // Surfaces: cards sit on a slightly cooler page, set apart by a border and a soft two-layer shadow.
  const border = dark ? 'rgba(255,255,255,0.14)' : '#D5DDE7'
  const shadow = dark
    ? '0 1px 2px rgba(0,0,0,0.5), 0 2px 6px rgba(0,0,0,0.25)'
    : '0 1px 2px rgba(16,33,52,0.06), 0 2px 6px rgba(16,33,52,0.05)'
  const hoverShadow = dark
    ? '0 2px 4px rgba(0,0,0,0.5), 0 6px 16px rgba(0,0,0,0.3)'
    : '0 2px 4px rgba(16,33,52,0.08), 0 6px 16px rgba(16,33,52,0.08)'
  const focusRing = { outline: `2px solid ${alpha(primary, dark ? 0.9 : 0.75)}`, outlineOffset: 2 }
  const text = dark ? { primary: '#E8EEF5', secondary: '#AEBBCA' } : { primary: '#111C27', secondary: '#3F4D5D' }
  return createTheme({
    palette: {
      mode,
      primary: { main: primary },
      secondary: { main: dark ? '#4DB6AC' : '#00897B' },
      // Text-coloured states (an overdue count, an over-budget note) need lighter tones on dark surfaces.
      error: { main: dark ? TONE.red : '#B3261E' },
      warning: { main: dark ? TONE.amber : '#B26A00' },
      success: { main: dark ? TONE.green : '#1E7D45' },
      background: dark ? { default: '#0B121A', paper: '#16212C' } : { default: '#EEF2F6', paper: '#FFFFFF' },
      divider: dark ? 'rgba(255,255,255,0.12)' : '#E1E7EE',
      text,
      action: { selected: alpha(primary, dark ? 0.2 : 0.1), hover: alpha(primary, dark ? 0.12 : 0.06) },
    },
    shape: { borderRadius: 10 },
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
      MuiCssBaseline: {
        styleOverrides: {
          // Keyboard users always see where they are; mouse clicks don't leave a ring behind.
          ':focus-visible:not(.MuiInputBase-input)': focusRing,
          // People who ask for less motion get none: no transitions, ripples or animated skeletons.
          '@media (prefers-reduced-motion: reduce)': {
            '*, *::before, *::after': {
              animationDuration: '0.01ms !important', animationIterationCount: '1 !important',
              transitionDuration: '0.01ms !important', scrollBehavior: 'auto !important',
            },
          },
        },
      },
      MuiButtonBase: { styleOverrides: { root: { '&.Mui-focusVisible': focusRing } } },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: {
            transition: 'background-color 120ms ease, box-shadow 120ms ease, transform 80ms ease',
            '&:active:not(.Mui-disabled)': { transform: 'translateY(1px)' },
          },
          contained: { '&:active': { boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.2)' } },
          // Below md (touch) a small button is still a 44 px target: This week, This month, Start timer, Message, Print…
          sizeSmall: { '@media (max-width: 899.95px)': { minHeight: 44 } },
          outlined: { '&:active': { backgroundColor: alpha(primary, 0.14) } },
          text: { '&:active': { backgroundColor: alpha(primary, 0.14) } },
        },
      },
      MuiIconButton: { styleOverrides: { root: { '&:active': { backgroundColor: alpha(primary, 0.16) } } } },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            '&:active': { backgroundColor: alpha(primary, dark ? 0.24 : 0.14) },
            '&.Mui-selected': { backgroundColor: alpha(primary, dark ? 0.2 : 0.1) },
          },
        },
      },
      MuiMenuItem: { styleOverrides: { root: { '&:active': { backgroundColor: alpha(primary, 0.14) } } } },
      MuiTab: { styleOverrides: { root: { '&:active': { backgroundColor: alpha(primary, 0.1) } } } },
      // View toggles (Day / Week / Month, List / Timeline): the chosen one is primary text on the selected tint, as drawn;
      // the others recede in secondary text, so the choice never reads backwards in dark mode.
      MuiToggleButton: {
        styleOverrides: {
          root: {
            color: text.secondary,
            '&.Mui-selected, &.Mui-selected:hover': { color: primary, backgroundColor: alpha(primary, dark ? 0.2 : 0.1) },
          },
        },
      },
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: { outlined: { borderColor: border, boxShadow: shadow } },
      },
      MuiCard: {
        defaultProps: { variant: 'outlined' },
        // Clickable cards lift a little on hover.
        styleOverrides: { root: { transition: 'box-shadow 160ms ease, transform 160ms ease, border-color 160ms ease',
          '&:has(.MuiCardActionArea-root:hover)': { boxShadow: hoverShadow, transform: 'translateY(-2px)',
            borderColor: alpha(primary, dark ? 0.5 : 0.35) } } },
      },
      MuiCardActionArea: {
        styleOverrides: {
          root: {
            transition: 'background-color 120ms ease',
            '&:hover': { backgroundColor: alpha(primary, 0.04) },
            '&:active': { backgroundColor: alpha(primary, 0.1) },
          },
          focusHighlight: { opacity: 0 },
        },
      },
      MuiDrawer: { styleOverrides: { paper: { borderColor: border } } },
      MuiAppBar: { styleOverrides: { root: { backgroundColor: dark ? '#16212C' : '#FFFFFF' } } },
      MuiTableCell: {
        styleOverrides: {
          head: { fontWeight: 600, color: dark ? '#AEBBCA' : '#3F4D5D', backgroundColor: dark ? 'rgba(255,255,255,0.03)' : '#F7F9FB' },
        },
      },
      MuiLinearProgress: { styleOverrides: { root: { backgroundColor: alpha(primary, 0.16) } } },
      MuiTextField: { defaultProps: { fullWidth: true, size: 'small' } },
      MuiChip: { styleOverrides: { root: { fontWeight: 600 } } },
      MuiTooltip: { defaultProps: { arrow: true } },
      MuiLink: { styleOverrides: { root: { fontWeight: 500, borderRadius: 2 } } },
    },
  })
}
