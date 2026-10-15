// Initials sit on one of these, picked by user id so a person keeps the same colour everywhere.
// Each passes WCAG AA contrast with white text.
const COLOURS = ['#0B5CAD', '#1E7D45', '#6B3FA0', '#B3261E', '#8A4B00', '#00695C', '#4A5868', '#AD1457']

// One size per context, so circles look the same wherever they appear.
export const AVATAR_SIZE = { inline: 28, row: 36, header: 36 }

// Below this a circle is too small for two letters, so it shows one.
const TWO_LETTER_MIN = 24

export function colourFor(key) {
  let hash = 0
  for (const ch of String(key ?? '')) hash = (hash * 31 + ch.codePointAt(0)) >>> 0
  return COLOURS[hash % COLOURS.length]
}

/** "Ada Lovelace" -> "AL"; `max` 1 gives just the first initial. */
export function initials(name, max = 2) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  const both = parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')
  return both.slice(0, max).toUpperCase()
}

/** Initials typography for a circle `size` px across: always fits inside, even with a 2px ring drawn inward. */
export function initialsStyle(size) {
  return {
    fontSize: Math.max(9, Math.round(size * 0.38)),
    fontWeight: 600,
    letterSpacing: '-0.03em',
    lineHeight: 1,
  }
}

export function initialsFor(name, size) {
  return initials(name, size < TWO_LETTER_MIN ? 1 : 2)
}
