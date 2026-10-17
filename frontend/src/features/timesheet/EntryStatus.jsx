import { Box, Button, Chip, Tooltip, Typography } from '@mui/material'
import Critical from '../../components/Critical.jsx'
import SourceChip from '../timer/SourceChip.jsx'
import { ManualRequestChip } from './ManualCell.jsx'
import { KIND, KIND_ICON, chipSx, kindColor, kindText } from './monthText.js'

/** A saved entry's approval kind, for the words and colours the Month view uses. */
// eslint-disable-next-line react-refresh/only-export-components -- the brief puts entryKind beside the status components
export const entryKind = (entry) => (entry.status === 'approved' ? 'approved' : entry.status === 'rejected' ? 'rejected' : 'pending')

/** A small coloured dot. Decorative: the word beside it carries the meaning. */
export function StatusDot({ kind }) {
  return (
    <Box component="span" aria-hidden="true"
      sx={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, bgcolor: (t) => kindColor(kind, t) }} />
  )
}

/** The words StatusWords shows: "Needs revision", or "Pending, Overtime" for an over-40 entry. */
const statusText = (entry) => [KIND[entryKind(entry)].legend, entry.over_40 ? 'Overtime' : null].filter(Boolean).join(', ')

/** The entry's status as words: "Approved", "Pending" or "Needs revision", with "Overtime" beside it for an over-40 entry.
 * "Needs revision" and "Overtime" are bold. The words wrap rather than truncate in a narrow cell. Spans only, so it can
 * sit inside a button. `inline`: part of a left-aligned row (the Day view), with no space of its own above. */
export function StatusWords({ entry, inline = false }) {
  const kind = entryKind(entry)
  return (
    <Box component="span" sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: inline ? 'flex-start' : 'center',
      columnGap: 0.75, rowGap: 0.25, mt: inline ? 0 : 0.5 }}>
      <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
        <StatusDot kind={kind} />
        <Typography variant="caption" component="span" sx={{ color: (t) => kindText(kind, t), lineHeight: 1.2, fontWeight: 600 }}>
          {KIND[kind].critical ? <Critical>{KIND[kind].legend}</Critical> : KIND[kind].legend}
        </Typography>
      </Box>
      {entry.over_40 ? (
        <Typography variant="caption" component="span" sx={{ color: 'warning.main', lineHeight: 1.2 }}>
          <Critical>Overtime</Critical>
        </Typography>
      ) : null}
    </Box>
  )
}

/** A saved cell's status line: its StatusWords as a text button that opens Entry details. Its name starts with the words
 * it shows: "Pending, Overtime, details for Schema Mapping, Thu Oct 15". entryParam ("m1:2026-10-15") marks it as the
 * place focus returns to when the panel closes. */
export function StatusLine({ entry, cellLabel, entryParam, onOpen }) {
  return (
    <Button size="small" onClick={() => onOpen()} data-entry={entryParam} aria-label={`${statusText(entry)}, details for ${cellLabel}`}
      sx={{ display: 'flex', width: '100%', minWidth: 44, minHeight: 44, px: 0.25, py: 0, mt: 0.25, '& > span': { mt: 0 } }}>
      <StatusWords entry={entry} />
    </Button>
  )
}

/** The line's approval status as a chip: icon and word, in the status colours; "Needs revision" is bold. */
export function EntryStatusChip({ kind }) {
  const Icon = KIND_ICON[kind]
  return (
    <Box component="span" sx={[{ display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 0.75, py: 0.25, typography: 'caption',
      fontWeight: 600, whiteSpace: 'nowrap', color: (t) => kindText(kind, t) }, chipSx(kind)]}>
      <Icon sx={{ fontSize: 15, color: (t) => kindColor(kind, t) }} />
      {KIND[kind].critical ? <Critical>{KIND[kind].panel}</Critical> : KIND[kind].panel}
    </Box>
  )
}

/** The saved entry's status words, Edited, its source and Resubmit, then `after` (the Day view's Details), on one
 * left-aligned row that wraps; a rejection's reason is printed under it. */
export function CellStatus({ entry, cellLabel, onResubmit, resubmitting, closed, after }) {
  if (!entry) return null
  const reason = entry.status === 'rejected' ? entry.rejection_reason : null
  return (
    <>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-start', columnGap: 1, rowGap: 0.25,
        mt: 0.5 }}>
        <StatusWords entry={entry} inline />
        {entry.edited_after_decision ? <Chip size="small" label="Edited" variant="outlined" sx={{ height: 18 }} /> : null}
        {entry.manual ? <ManualRequestChip manual={entry.manual} />
          : <SourceChip source={entry.source} hours={entry.hours} trackedHours={entry.tracked_hours} />}
        {entry.status === 'rejected' && !resubmitting && !closed && !entry.manual ? (
          <Button size="small" onClick={onResubmit} aria-label={`Resubmit ${cellLabel}`} sx={{ minWidth: 0, px: 0.5 }}>
            Resubmit
          </Button>
        ) : null}
        {after}
      </Box>
      {reason ? (
        <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', lineHeight: 1.2, mt: 0.25 }}>
          Reason: {reason}
        </Typography>
      ) : null}
    </>
  )
}
