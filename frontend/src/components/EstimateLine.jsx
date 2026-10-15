import { Typography } from '@mui/material'
import { TONE_TEXT } from '../app/chartColors.js'
import { timeFrameLine, usageLine } from '../lib/estimates.js'

/** A milestone's expected time frame and, once hours are logged, how much of its estimate they use. */
export default function EstimateLine({ milestone }) {
  const frame = timeFrameLine(milestone)
  const usage = usageLine(milestone)
  if (!frame && !usage) return null
  return (
    <Typography variant="body2" component="div" sx={{ color: 'text.secondary', mt: 0.25 }}>
      {frame}
      {usage ? (
        <>
          {frame ? ' · ' : ''}
          <Typography component="span" variant="body2" sx={{ color: TONE_TEXT[usage.tone], fontWeight: usage.tone === 'ok' ? 400 : 600 }}>
            {usage.text}
          </Typography>
        </>
      ) : null}
    </Typography>
  )
}
