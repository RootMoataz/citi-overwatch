import Schedule from '@mui/icons-material/ScheduleOutlined'
import { createElement } from 'react'

// The "<N>h awaiting approval" banners on the Budget and Hours tabs: amber, as pending is everywhere else, with a clock.
// MUI's Alert puts its action higher than the text, so the banner centres its parts and the action slot drops its top
// padding, keeping the link on the message's line. On a phone (xs) the parts wrap: the link takes its own full-width
// line under the message, lined up with its text, instead of squeezing the message into a narrow column.
export const BANNER_PROPS = {
  severity: 'warning',
  icon: createElement(Schedule, { fontSize: 'inherit' }),
  sx: { alignItems: 'center', flexWrap: { xs: 'wrap', sm: 'nowrap' } },
  slotProps: {
    // The message takes the room beside the icon (never wrapping under it); the action drops to its own line on xs.
    message: { sx: { flex: '1 1 0', minWidth: 0 } },
    action: { sx: { pt: 0, alignItems: 'center', width: { xs: '100%', sm: 'auto' }, ml: { xs: 0, sm: 'auto' },
      pl: { xs: '34px', sm: 2 } } },
  },
}

/** The banner's link: a 44 px target on phones, its text's height from md. */
export const BANNER_LINK_SX = { fontWeight: 600, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center',
  minHeight: { xs: 44, md: 'auto' } }
