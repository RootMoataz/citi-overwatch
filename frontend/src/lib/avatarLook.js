// Initials sit on one of these, picked by user id so a person keeps the same colour everywhere.
// Each passes WCAG AA contrast with white text.
const COLOURS = ['#0B5CAD', '#1E7D45', '#6B3FA0', '#B3261E', '#8A4B00', '#00695C', '#4A5868', '#AD1457']

export function colourFor(key) {
  let hash = 0
  for (const ch of String(key ?? '')) hash = (hash * 31 + ch.codePointAt(0)) >>> 0
  return COLOURS[hash % COLOURS.length]
}

export function initials(name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}
