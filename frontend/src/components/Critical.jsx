import { Box } from '@mui/material'

/** The weight of a critical detail. Bold is the one signal: the colour stays whatever the text already has. */
export const CRITICAL_WEIGHT = 700

/**
 * A critical detail, in bold: lateness ("8 days overdue", "Due today"), a limit passed ("5h over 40h", "Over budget"),
 * a status waiting on someone ("Needs revision", "Waiting on Design", "3 pending"), a risk word ("Past due") or an
 * urgent priority ("Critical priority"). A <strong>, so it also reads as important; the colour is inherited.
 * Chips that carry one of these words put their label in it themselves (PriorityChip, StatusChip, RiskBadges…).
 * `sx` is for layout only (a mark that must not shrink, say); the weight always stays bold.
 */
export default function Critical({ children, sx }) {
  const layout = (Array.isArray(sx) ? sx : [sx]).filter(Boolean)
  return <Box component="strong" sx={[...layout, { fontWeight: CRITICAL_WEIGHT }]}>{children}</Box>
}

/** `text` with its critical `part` in bold, the rest as it was: "Due Oct 8, 2026 · **8 days overdue**". The last match
 * wins, since a name comes before its status ("noncritical audit is **critical**…"). With no part, or a part the text
 * doesn't hold, just the text. */
export function CriticalIn({ text, part }) {
  const at = part ? text.lastIndexOf(part) : -1
  if (at < 0) return text
  return <>{text.slice(0, at)}<Critical>{part}</Critical>{text.slice(at + part.length)}</>
}
