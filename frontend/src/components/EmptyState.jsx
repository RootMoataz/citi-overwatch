import InboxOutlined from '@mui/icons-material/InboxOutlined'
import { Box, Typography } from '@mui/material'

/** Every empty list says what it is and what to do next. */
export default function EmptyState({ title, description, action, icon }) {
  return (
    <Box sx={{ textAlign: 'center', py: 6, px: 2, color: 'text.secondary' }}>
      <Box aria-hidden sx={{ fontSize: 40, mb: 1, color: 'text.disabled' }}>{icon ?? <InboxOutlined fontSize="inherit" />}</Box>
      <Typography variant="subtitle1" component="p" sx={{ color: 'text.primary' }}>{title}</Typography>
      {description ? <Typography variant="body2" sx={{ mt: 0.5 }}>{description}</Typography> : null}
      {action ? <Box sx={{ mt: 2 }}>{action}</Box> : null}
    </Box>
  )
}
