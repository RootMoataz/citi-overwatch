import Search from '@mui/icons-material/Search'
import { InputAdornment, Stack, TextField } from '@mui/material'
import { useMediaQuery } from 'react-responsive'
import { DESKTOP_QUERY } from '../lib/responsive.js'

// Below md, every field, select, button and switch in the bar is at least 44 px tall.
const touch = {
  '& .MuiInputBase-root, & .MuiButton-root, & .MuiFormControlLabel-root': { minHeight: 44 },
}

/** A search field, then selects and switches (`children`), with `end` pushed to the right. Stacks on phones. */
export default function FilterBar({ search, children, end }) {
  const desktop = useMediaQuery(DESKTOP_QUERY)
  return (
    <Stack sx={{ flexDirection: desktop ? 'row' : 'column', alignItems: desktop ? 'center' : 'stretch', gap: 1.5,
      flexWrap: 'wrap', ...(desktop ? null : touch) }}>
      {search ? (
        <TextField size="small" value={search.value} onChange={(e) => search.onChange(e.target.value)}
          placeholder={search.placeholder} sx={{ minWidth: { md: 260 }, flex: { md: '0 1 320px' } }}
          slotProps={{
            htmlInput: { 'aria-label': search.label },
            input: { startAdornment: <InputAdornment position="start"><Search fontSize="small" aria-hidden /></InputAdornment> },
          }} />
      ) : null}
      {children}
      {end ? <Stack sx={{ flexDirection: 'row', alignItems: 'center', gap: 1, ml: { md: 'auto' } }}>{end}</Stack> : null}
    </Stack>
  )
}
