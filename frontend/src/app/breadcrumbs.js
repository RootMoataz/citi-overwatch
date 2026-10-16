import { createContext, createElement, useContext, useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
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

// Pages that draw their own back control on phones (a thread's "Back to conversations"): no second one in the top bar.
const OWN_BACK = /^\/messages\/[^/]+\/?$/

/** The crumb a phone's back link goes to on a nested page (a project, a person), or null on a page with none. The
 * parent never depends on the page's own name, so the top bar knows it before the page loads. */
export function parentCrumb(pathname, user) {
  if (OWN_BACK.test(pathname)) return null
  const crumbs = crumbsFor(pathname, user, null)
  const parent = crumbs.length > 1 ? crumbs[crumbs.length - 2] : null
  return parent?.to ? parent : null
}

const BreadcrumbContext = createContext(null)

/** Holds the name the open page gives its last crumb, with the address it was given for. Wrap the shell (top bar
 * and page) in it. */
export function BreadcrumbProvider({ children }) {
  const [entry, setEntry] = useState(null) // { pathname, label }
  const value = useMemo(() => ({ entry, setEntry }), [entry])
  return createElement(BreadcrumbContext.Provider, { value }, children)
}

/**
 * A page calls this with its own name (it may be undefined while loading); the crumb clears when the page goes.
 * Pass `{ failed: true }` when the page couldn't load: with no name the last crumb then reads "Not found" instead of
 * a skeleton that never resolves. Pass `{ enabled: false }` from a view embedded in a page (a thread inside a panel),
 * which must not rename the page's crumb.
 */
export function useBreadcrumb(label, { failed = false, enabled = true } = {}) {
  const { pathname } = useLocation()
  const setEntry = useContext(BreadcrumbContext)?.setEntry
  const shown = label || (failed ? 'Not found' : null)
  useEffect(() => {
    if (!setEntry || !enabled) return undefined
    setEntry({ pathname, label: shown })
    return () => setEntry((entry) => (entry?.pathname === pathname ? null : entry))
  }, [setEntry, pathname, shown, enabled])
}

/**
 * The label the open page named, or null. A label given for another address is ignored: on the first render after
 * moving from project A to project B the old page's name is still held (its clean-up hasn't run yet), and it must
 * never show on B.
 */
export function useCrumbLabel() {
  const { pathname } = useLocation()
  const entry = useContext(BreadcrumbContext)?.entry
  return entry && entry.pathname === pathname ? entry.label : null
}
