// Every colour a chart draws with, defined once, with a light and a dark step for each role.
//
// Categorical (one hue per series, assigned in this fixed order, never cycled) passes the dataviz validator against
// both card surfaces (#FFFFFF light, #16212C dark): lightness band, chroma floor, colour-blind separation of
// neighbours (worst ΔE 9.1 light / 8.4 dark, target ≥ 8) and the normal-vision floor (19.6 / 19.3, ≥ 15).
// In light mode aqua, yellow and pink sit under 3:1 against white, so charts using them always label each slice
// with its value as text too.
//
// Semantic (meaning, not identity) is shared by every chart, data bar and meter:
//   ok      within the limit (the data colour: blue)
//   warning heading over (a forecast past the budget)
//   alert   over the limit (spent past the budget, more than 40h)
// They always come with a word or a ⚠, never colour alone.

const LIGHT = {
  series: ['#2A78D6', '#EB6834', '#1BAF7A', '#EDA100', '#E87BA4', '#008300', '#6250D6', '#E34948'],
  ok: '#2A78D6',
  warning: '#C98500',
  alert: '#D03B3B',
  // The ghost behind a bar: the budget, the planned hours. Visible on white but quieter than the data.
  track: '#DDE4EC',
  ghost: '#B7C6D8',
  // Markers (forecast) and reference lines (40h, 100%) are ink, not a hue.
  marker: '#111C27',
  reference: '#5B6B7F',
}

const DARK = {
  series: ['#3987E5', '#D95926', '#199E70', '#C98500', '#D55181', '#008300', '#9085E9', '#E66767'],
  ok: '#3987E5',
  warning: '#FAB219',
  alert: '#E66767',
  track: '#33465A',
  ghost: '#4A5D73',
  marker: '#E8EEF5',
  reference: '#9AA9BA',
}

/** The chart colours for the current theme (`theme` or a palette mode). */
export function chartPalette(themeOrMode) {
  const mode = typeof themeOrMode === 'string' ? themeOrMode : themeOrMode?.palette?.mode
  return mode === 'dark' ? DARK : LIGHT
}

/** ok / warning / alert for a share of a limit: over 100% is alert; `warnAt` (a %) turns it amber before that. */
export function toneFor(pct, { warnAt = Infinity } = {}) {
  const value = Number(pct ?? 0)
  if (value > 100) return 'alert'
  if (value >= warnAt) return 'warning'
  return 'ok'
}

/** The theme palette name for a tone, for text that sits beside a mark ("112%" in the alert colour). */
export const TONE_TEXT = { ok: 'text.primary', warning: 'warning.main', alert: 'error.main' }
