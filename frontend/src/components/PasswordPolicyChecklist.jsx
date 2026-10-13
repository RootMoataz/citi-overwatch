import CheckCircle from '@mui/icons-material/CheckCircle'
import RadioButtonUnchecked from '@mui/icons-material/RadioButtonUnchecked'
import { Box, Typography } from '@mui/material'
import { PASSWORD_RULES } from '../lib/schemas.js'

/** Live checklist of the password rules; each line says whether it's met (not just by color). */
export default function PasswordPolicyChecklist({ value = '' }) {
  return (
    <Box component="ul" aria-label="Password requirements" aria-live="polite"
      sx={{ listStyle: 'none', p: 0, m: 0, display: 'grid', gap: 0.5 }}>
      {PASSWORD_RULES.map((rule) => {
        const met = rule.test(value)
        return (
          <Box component="li" key={rule.code} data-met={String(met)}
            sx={{ display: 'flex', alignItems: 'center', gap: 1, color: met ? 'success.main' : 'text.secondary' }}>
            {met ? <CheckCircle fontSize="small" aria-hidden /> : <RadioButtonUnchecked fontSize="small" aria-hidden />}
            <Typography variant="body2" component="span">{rule.label}</Typography>
            <Box component="span" sx={visuallyHidden}>{met ? '(done)' : '(not yet)'}</Box>
          </Box>
        )
      })}
    </Box>
  )
}

const visuallyHidden = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }
