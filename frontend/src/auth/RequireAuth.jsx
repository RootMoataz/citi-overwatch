import { Box, CircularProgress } from '@mui/material'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { NO_ACCESS } from '../app/access.js'
import RedirectHome from '../app/RedirectHome.jsx'
import ForcePasswordChange from './ForcePasswordChange.jsx'
import { useSession } from './sessionContext.js'

/** Guards app routes: sign-in first, then the forced password change, then the role check (a role that can't
 * open the page is sent home with a message; see ROUTE_ROLES). */
export default function RequireAuth({ roles, children }) {
  const { user, status } = useSession()
  const location = useLocation()

  if (status === 'loading') {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '60vh' }}>
        <CircularProgress aria-label="Loading your session" />
      </Box>
    )
  }
  if (status === 'anon') {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  }
  if (status === 'restricted') return <ForcePasswordChange />
  if (roles && !roles.includes(user.role)) return <RedirectHome message={NO_ACCESS} />
  return children ?? <Outlet />
}
