import CalendarMonthOutlined from '@mui/icons-material/CalendarMonthOutlined'
import ChevronLeft from '@mui/icons-material/ChevronLeft'
import ChevronRight from '@mui/icons-material/ChevronRight'
import { Box, Button, IconButton } from '@mui/material'

// The week pickers' one look, from the mockups (My week, My timesheet, a project's Hours): bordered chevrons around the
// date, which sits in a bordered box after a calendar icon, then "This week" as a text button. 40 px from md, 44 px
// touch targets below it.
const SIZE = { xs: 44, md: 40 }
const FRAME = { border: 1, borderColor: 'divider', borderRadius: 1, bgcolor: 'background.paper' }

/** ‹ or ›, named "Previous week" or "Next week". */
export function WeekStep({ direction, onClick, disabled }) {
  const previous = direction === 'previous'
  return (
    <IconButton aria-label={previous ? 'Previous week' : 'Next week'} onClick={onClick} disabled={disabled}
      sx={{ ...FRAME, width: SIZE, height: SIZE }}>
      {previous ? <ChevronLeft /> : <ChevronRight />}
    </IconButton>
  )
}

/** The week's dates in their box, after a calendar icon: decorative, or with `onPick` a button named "Pick a week" that
 * opens a date picker (its own name, as the icon is its only content). */
export function WeekRange({ children, onPick }) {
  return (
    <Box sx={{ ...FRAME, display: 'inline-flex', alignItems: 'center', gap: 0.75, minHeight: SIZE, pl: onPick ? 0 : 1.25, pr: 1.5,
      minWidth: 0 }}>
      {onPick ? (
        <IconButton aria-label="Pick a week" onClick={onPick} sx={{ width: SIZE, height: SIZE, color: 'text.secondary' }}>
          <CalendarMonthOutlined fontSize="small" />
        </IconButton>
      ) : <CalendarMonthOutlined fontSize="small" aria-hidden sx={{ color: 'text.secondary' }} />}
      {children}
    </Box>
  )
}

/** "This week", a text button. */
export function ThisWeekButton({ onClick, disabled }) {
  return <Button onClick={onClick} disabled={disabled} sx={{ minHeight: SIZE, px: 1.5, whiteSpace: 'nowrap' }}>This week</Button>
}
