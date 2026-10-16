import ArrowBack from '@mui/icons-material/ArrowBack'
import { Box, Link, Skeleton, Typography } from '@mui/material'
import { Link as RouterLink, useLocation } from 'react-router-dom'
import { crumbsFor, useCrumbLabel } from './breadcrumbs.js'

// Pages that draw their own back control on phones (a thread's "Back to conversations"): no second one in the top bar.
const OWN_BACK = /^\/messages\/[^/]+\/?$/

/** Desktop: the full trail. Phones: on a nested page only a "‹ parent" link back. In the top bar only the crumbs give
 * way when space runs out: every crumb but the last keeps its width, and the last one (a name of up to 120 characters)
 * ends in an ellipsis. */
export default function Breadcrumbs({ user, desktop }) {
  const { pathname } = useLocation()
  const crumbs = crumbsFor(pathname, user, useCrumbLabel())

  if (!desktop) {
    const parent = crumbs.length > 1 ? crumbs[crumbs.length - 2] : null
    if (!parent?.to || OWN_BACK.test(pathname)) return null
    return (
      <Link component={RouterLink} to={parent.to} underline="hover" color="text.primary"
        sx={{ display: 'block', minWidth: 0, flexShrink: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          fontWeight: 600 }}>
        <Box component="span" aria-hidden>‹ </Box>{parent.label}
      </Link>
    )
  }

  return (
    <Box component="nav" aria-label="Breadcrumb" sx={{ minWidth: 0, flexShrink: 1 }}>
      <Box component="ol" sx={{ display: 'flex', alignItems: 'center', listStyle: 'none', m: 0, p: 0, minWidth: 0,
        '& > li': { display: 'flex', alignItems: 'center', flexShrink: 0, whiteSpace: 'nowrap' },
        '& > li:last-of-type': { flexShrink: 1, minWidth: 0 } }}>
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1
          return (
            <li key={`${index}-${crumb.label ?? 'pending'}`}>
              {index > 0 ? <Box component="span" aria-hidden="true" sx={{ mx: 1, color: 'text.disabled' }}>/</Box> : null}
              {crumb.pending ? (
                <Skeleton variant="text" width={96} aria-current="page" aria-busy="true" />
              ) : crumb.to && !last ? (
                <Link component={RouterLink} to={crumb.to} underline="hover" variant="body2" color="text.secondary"
                  sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                  {index === 0 ? <ArrowBack fontSize="inherit" aria-hidden /> : null}{crumb.label}
                </Link>
              ) : (
                <Typography variant="body2" noWrap aria-current={last ? 'page' : undefined} title={last ? crumb.label : undefined}
                  sx={{ minWidth: 0, color: last ? 'text.primary' : 'text.secondary', fontWeight: last ? 600 : 400 }}>
                  {crumb.label}
                </Typography>
              )}
            </li>
          )
        })}
      </Box>
    </Box>
  )
}
