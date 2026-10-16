import { Box, CircularProgress } from '@mui/material'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { NO_ACCESS } from '../app/access.js'
import RedirectHome from '../app/RedirectHome.jsx'
import ForcePasswordChange from './ForcePasswordChange.jsx'
import { useSession } from './sessionContext.js'

/** Guards app routes: sign-in first, then the forced password change, then the role check (a role that can't
 * open the page is sent home with a message; see ROUTE_ROLES) and, for pages that depend on the person, `allow`
 * (see ROUTE_CHECKS). */
export default function RequireAuth({ roles, allow, children }) {
  const { user, status, signedOut } = useSession()
  const location = useLocation()

  if (status === 'loading') {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '60vh' }}>
        <CircularProgress aria-label="Loading your session" />
      </Box>
    )
  }
  if (status === 'anon') {
    // A deliberate sign-out leaves no return path; a fresh visit or an expired session returns here after sign-in.
    return <Navigate to="/login" replace state={signedOut ? null : { from: location.pathname + location.search }} />
  }
  if (status === 'restricted') return <ForcePasswordChange />
  if (roles && !roles.includes(user.role)) return <RedirectHome message={NO_ACCESS} />
  if (allow && !allow(user)) return <RedirectHome message={NO_ACCESS} />
  return children ?? <Outlet />
}
