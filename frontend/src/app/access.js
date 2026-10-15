// Who may open which page, and what happens when someone lands where they can't be: a typed URL, a bookmark,
// a stale link, or a page whose data the server refuses. They go to their home page with a short message.
import { useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useToast } from './toast.js'

/** Routes limited to some roles (paths as in App.jsx). The rest are open to every signed-in user; the server
 * still decides per record (a project you're not on, a profile you may not see). Kept in step with the
 * navigation's permission checks by a test. */
export const ROUTE_ROLES = {
  timesheet: ['admin', 'manager', 'employee'], // executives don't log hours
  approvals: ['admin', 'manager'],
  requests: ['admin', 'manager'],
  allocation: ['admin', 'manager', 'executive'],
  archive: ['admin', 'manager', 'executive'],
  people: ['admin'],
  'people/:id': ['admin'],
  departments: ['admin'],
  audit: ['admin', 'executive'],
  messages: ['admin', 'manager', 'employee', 'executive'], // everyone; employees write only to their managers
  'messages/:id': ['admin', 'manager', 'employee', 'executive'],
}

export const NO_ACCESS = "You don't have access to that page."
export const NOT_FOUND = "That page doesn't exist."

/** Go home and say why. */
export function useRedirectHome() {
  const navigate = useNavigate()
  const toast = useToast()
  return useCallback((message) => {
    toast.warning(message)
    navigate('/', { replace: true })
  }, [navigate, toast])
}

/**
 * For a page's main query: a 403 sends the viewer home with the no-access message, a 404 with `notFound`
 * (pass NO_ACCESS where the server answers 404 to hide records, as the profile does). Returns true while
 * redirecting so the page can render nothing instead of a broken screen. Other errors are left to the page.
 * Never use it on the home page itself.
 */
export function useRedirectOnDenied(error, { notFound = NOT_FOUND } = {}) {
  const message = error?.status === 403 ? NO_ACCESS : error?.status === 404 ? notFound : null
  const redirect = useRedirectHome()
  useEffect(() => {
    if (message) redirect(message)
  }, [message, redirect])
  return Boolean(message)
}
