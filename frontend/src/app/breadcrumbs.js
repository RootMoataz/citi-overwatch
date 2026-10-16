import { createContext, createElement, useContext, useEffect, useMemo, useState } from 'react'
import { can } from '../lib/permissions.js'
import { NAV } from './nav.jsx'

const resolve = (value, user) => (typeof value === 'function' ? value(user) : value)

const WORK = 'Workspace'
const ADMIN = 'Administration'

/**
 * The trail for a page: `[{ label, to? }]`. The root crumb and the last crumb have no `to`.
 * `lastLabel` is the name a page gives itself (a project's or person's name); while it is missing the last crumb is
 * `{ pending: true }` so the bar can show a skeleton.
 */
export function crumbsFor(pathname, user, lastLabel) {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  const named = lastLabel ? { label: lastLabel } : { pending: true }
  const admin = user?.role === 'admin'

  if (/^\/projects\/[^/]+$/.test(path)) return [{ label: 'Projects', to: '/projects' }, named]
  if (/^\/messages\/[^/]+$/.test(path)) return [{ label: WORK }, { label: 'Messages', to: '/messages' }, named]
  const profile = /^\/people\/([^/]+)\/profile$/.exec(path)
  if (profile) {
    const own = user?.id != null && String(user.id) === decodeURIComponent(profile[1])
    if (own && user && can(user, 'history.own')) return [{ label: WORK }, { label: 'My history' }]
    if (admin) return [{ label: ADMIN }, { label: 'People', to: '/people' }, named]
    return [{ label: WORK }, named]
  }
  if (/^\/people\/[^/]+$/.test(path)) return [{ label: ADMIN }, { label: 'People', to: '/people' }, named]
  if (path === '/profile') return [{ label: WORK }, { label: 'My profile' }]

  const item = user ? NAV.find((entry) => resolve(entry.to, user) === path) : null
  if (item) return [{ label: item.admin && admin ? ADMIN : WORK }, { label: resolve(item.label, user) }]
  return [{ label: WORK }, { label: 'Page not found' }]
}

const BreadcrumbContext = createContext(null)

/** Holds the name the open page gives its last crumb. Wrap the shell (top bar and page) in it. */
export function BreadcrumbProvider({ children }) {
  const [label, setLabel] = useState(null)
  const value = useMemo(() => ({ label, setLabel }), [label])
  return createElement(BreadcrumbContext.Provider, { value }, children)
}

/** A page calls this with its own name (it may be undefined while loading); the crumb clears when the page goes. */
export function useBreadcrumb(label) {
  const context = useContext(BreadcrumbContext)
  const setLabel = context?.setLabel
  useEffect(() => {
    if (!setLabel) return undefined
    setLabel(label || null)
    return () => setLabel(null)
  }, [setLabel, label])
}

/** The label the open page named, or null. */
export function useCrumbLabel() {
  return useContext(BreadcrumbContext)?.label ?? null
}
