import { TextField } from '@mui/material'
import { alpha } from '@mui/material/styles'

// Hours are plain numbers: digits and one point, at most 2 digits either side, so "-", "+" and "e" never get in.
// Typed and pasted text both arrive through onChange, so both are cleaned here.
const cleanHours = (raw) => {
  const [whole, ...rest] = String(raw).replace(/[^\d.]/g, '').split('.')
  return rest.length ? `${whole.slice(0, 2)}.${rest.join('').slice(0, 2)}` : whole.slice(0, 2)
}
// A paste is taken only when it is already a clean value; anything else ("-3", "1e1", "7.5h") is refused whole
// rather than half-cleaned into a different number.
const CLEAN_PASTE = /^\d{1,2}(\.\d{1,2})?$/
// Keys that could start a negative, an exponent or a letter never reach the cell.
const allowedKey = (e) => e.ctrlKey || e.metaKey || e.altKey || e.key.length > 1 || /[\d.]/.test(e.key)

/** The hours input of one cell, in the week grid and the day view alike. onChange(text) gets the cleaned text.
 * label is its accessible name; caption (optional) is a visible label that does not replace it. `compact`: narrower on a
 * phone (the week grid's day columns), or at every width with 'always' (beside an open panel); `dim`: a quiet grey fill
 * (an empty weekend cell). */
export default function HoursField({ value, label, caption, onChange, error, disabled, compact = false, dim = false }) {
  return (
    <TextField label={caption} value={value} onChange={(e) => onChange(cleanHours(e.target.value))} disabled={disabled}
      onKeyDown={(e) => { if (!allowedKey(e)) e.preventDefault() }}
      onPaste={(e) => {
        e.preventDefault()
        const text = e.clipboardData.getData('text').trim()
        if (CLEAN_PASTE.test(text)) onChange(text)
      }}
      error={error}
      slotProps={{ htmlInput: { inputMode: 'decimal', pattern: '[0-9]{0,2}([.][0-9]{0,2})?',
        'aria-label': label, style: { textAlign: 'center' } },
      input: dim ? { 'data-dim': '' } : undefined }}
      sx={{ width: compact === 'always' ? 56 : compact ? { xs: 52, sm: 76 } : 76,
        // A 44 px target below md (the box is 40 px tall otherwise).
        '& .MuiOutlinedInput-root': { minHeight: { xs: 44, md: 'auto' } },
        ...(dim ? { '& .MuiOutlinedInput-root': { minHeight: { xs: 44, md: 'auto' }, bgcolor: (t) => alpha(t.palette.text.primary, 0.04) } } : null) }} />
  )
}
