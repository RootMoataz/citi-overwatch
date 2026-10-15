// What the command palette can offer the viewer (pages, actions) and how typed text ranks the results. Pure.
import { ROUTE_ROLES } from '../../app/access.js'
import { can } from '../../lib/permissions.js'
import { normalize } from './phrases.js'

const HOME = { employee: 'My week', admin: 'Control centre' }
const mayOpen = (user, route) => !ROUTE_ROLES[route] || ROUTE_ROLES[route].includes(user?.role)

/** Every page the viewer may open, with words people might type for it. */
export function pagesFor(user) {
  if (!user) return []
  const pages = [
    { label: HOME[user.role] ?? 'Dashboard', to: '/', keywords: 'home dashboard overview' },
    { label: 'Projects', to: '/projects', keywords: 'portfolio list' },
    can(user, 'timesheet.use') && { label: 'My timesheet', to: '/timesheet', keywords: 'hours log time week' },
    can(user, 'history.own') && { label: 'My history', to: `/people/${user.id}/profile`, keywords: 'hours past' },
    mayOpen(user, 'approvals') && { label: 'Approvals', to: '/approvals', keywords: 'pending hours approve' },
    mayOpen(user, 'allocation') && { label: 'Allocation', to: '/allocation', keywords: 'workload capacity utilization' },
    mayOpen(user, 'people') && { label: 'People', to: '/people', keywords: 'users accounts staff' },
    mayOpen(user, 'departments') && { label: 'Departments', to: '/departments', keywords: 'teams' },
    mayOpen(user, 'requests') && { label: 'Project requests', to: '/requests', keywords: 'new proposals' },
    mayOpen(user, 'archive') && { label: 'Archive', to: '/archive', keywords: 'restore archived' },
    mayOpen(user, 'audit') && { label: 'Audit log', to: '/audit', keywords: 'history changes who' },
    { label: 'My profile', to: '/profile', keywords: 'account password photo settings' },
  ]
  return pages.filter(Boolean).map((p) => ({ ...p, id: `page:${p.to}`, group: 'Pages', kind: 'navigate' }))
}

/** Things to do rather than places to go. `mode` is the theme on screen now. */
export function actionsFor(user, mode = 'light') {
  if (!user) return []
  const other = mode === 'dark' ? 'light' : 'dark'
  const actions = [
    can(user, 'project.create') && { id: 'action:new-project', label: 'New project', kind: 'navigate', to: '/projects?new=1',
      keywords: 'create add' },
    can(user, 'request.submit') && { id: 'action:request-project', label: 'Request a new project', kind: 'navigate',
      to: '/requests?new=1', keywords: 'create add new project' },
    can(user, 'timesheet.use') && { id: 'action:log-hours', label: 'Log my hours', kind: 'navigate', to: '/timesheet',
      keywords: 'timesheet time' },
    { id: 'action:theme', label: `Switch to ${other} mode`, kind: 'theme', mode: other, keywords: 'theme colour color dark light' },
    { id: 'action:signout', label: 'Sign out', kind: 'signout', keywords: 'log out logout leave' },
  ]
  return actions.filter(Boolean).map((a) => ({ ...a, group: 'Actions' }))
}

/** How well `query` matches an item: 0 (no match) to 100 (exact). Matches the label first, then keywords. */
export function score(query, label, keywords = '') {
  const q = normalize(query)
  if (!q) return 1
  const name = normalize(label)
  if (name === q) return 100
  if (name.startsWith(q)) return 80
  if (name.split(' ').some((w) => w.startsWith(q))) return 60
  if (name.includes(q)) return 40
  const words = q.split(' ')
  const haystack = `${name} ${normalize(keywords)}`
  if (words.every((w) => haystack.split(' ').some((h) => h.startsWith(w)))) return 20
  return 0
}

export const GROUP_ORDER = ['Pages', 'Projects', 'People', 'Milestones', 'Actions']
const LIMITS = { Pages: 6, Projects: 6, People: 5, Milestones: 6, Actions: 5 }

/** The items that match, best first within each group, groups in GROUP_ORDER, at most a few per group. */
export function rank(query, items) {
  const scored = items.map((item) => ({ item, s: score(query, item.label, `${item.keywords ?? ''} ${item.detail ?? ''}`) }))
    .filter((x) => x.s > 0)
  const out = []
  for (const group of GROUP_ORDER) {
    const inGroup = scored.filter((x) => x.item.group === group).sort((a, b) => b.s - a.s)
    out.push(...inGroup.slice(0, normalize(query) ? LIMITS[group] : Math.min(LIMITS[group], 4)).map((x) => x.item))
  }
  return out
}

/** True when a key press belongs to a field (so "/" types a slash there instead of opening the palette). */
export function typingIn(target) {
  if (!target) return false
  return Boolean(target.isContentEditable) || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}
