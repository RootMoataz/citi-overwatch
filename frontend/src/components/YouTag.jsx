import { Chip } from '@mui/material'

/** "You" beside the viewer's own name or milestone, in a list of other people's. */
export default function YouTag() {
  return <Chip size="small" variant="outlined" color="primary" label="You" sx={{ height: 20, fontSize: '0.6875rem' }} />
}
