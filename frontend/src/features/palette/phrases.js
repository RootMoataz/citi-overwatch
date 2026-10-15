// The command palette's plain-English layer: a few fixed rules (no AI, nothing leaves the browser) that turn a
// phrase into one action, usually a filtered page. Pure, so every rule is unit tested.
//
// parsePhrase(text, { user, projects, people, departments }) → intent or null, where an intent is
//   { kind: 'navigate', to, chips, label }        open a page (chips show how the phrase was read)
//   { kind: 'theme', mode: 'dark'|'light', ... }   switch the colour theme
//   { kind: 'signout', ... }                       sign out
// plus `milestones: 'overdue' | 'critical' | 'high'` when the palette should list only those milestones (high means
// high or critical).
// Only intents the viewer may act on come back: the same role rules as the pages (ROUTE_ROLES, can, canViewProfile).
import { ROUTE_ROLES } from '../../app/access.js'
import { can, canViewProfile } from '../../lib/permissions.js'

const STATUS_WORDS = [
  [/\bon[\s-]?hold\b|\bpaused\b/, 'on_hold', 'On hold'],
  [/\b(?:completed|finished|done|closed)\b/, 'completed', 'Completed'],
  [/\bactive\b|\bin progress\b|\brunning\b/, 'active', 'Active'],
  [/\bplanned\b|\bupcoming\b|\bnot started\b/, 'planned', 'Planned'],
]
const AT_RISK = /\bat[\s-]?risk\b|\brisky\b|\bin trouble\b|\bslipping\b/

const mayOpen = (user, route) => !ROUTE_ROLES[route] || ROUTE_ROLES[route].includes(user?.role)

/** Lower case, curly quotes made straight, punctuation other than ' and - dropped, spaces squeezed. */
export function normalize(text) {
  return String(text ?? '').toLowerCase().replace(/[‘’]/g, "'").replace(/[^a-z0-9' -]+/g, ' ')
    .replace(/\s+/g, ' ').trim()
}

const fullName = (p) => p.name ?? `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim()

/** The project whose name best matches `needle`: exact, then starts with, then contains (shortest name wins). */
export function findByName(items, needle, nameOf = (i) => i.name) {
  const n = normalize(needle)
  if (!n) return null
  const named = items.map((item) => ({ item, name: normalize(nameOf(item)) })).filter((x) => x.name)
  const pick = (test) => named.filter(test).sort((a, b) => a.name.length - b.name.length)[0]?.item ?? null
  return pick((x) => x.name === n) ?? pick((x) => x.name.startsWith(n)) ?? pick((x) => x.name.includes(n))
}

/** A person by full name, first name or last name. */
function findPerson(people, needle) {
  const n = normalize(needle)
  if (!n) return null
  return findByName(people, n, fullName)
    ?? people.find((p) => normalize(p.first_name) === n || normalize(p.last_name) === n)
    ?? people.find((p) => normalize(fullName(p)).split(' ').some((part) => part.startsWith(n) && n.length >= 3))
    ?? null
}

/** A department named in the phrase as a whole word (longest name first, so "Data Science" beats "Data"). */
function findDepartment(departments, text) {
  return [...departments].sort((a, b) => b.name.length - a.name.length)
    .find((d) => new RegExp(`(^|\\s)${escapeRegExp(normalize(d.name))}(\\s|$)`).test(text)) ?? null
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const navigate = (to, chips, label, extra = {}) => ({ kind: 'navigate', to, chips, label, ...extra })

function theme(text) {
  const match = /^(?:(?:switch|change|go|turn)(?: on| to)?\s+)?(?:to\s+)?(dark|light|night|day)(?:\s+(?:mode|theme))?(?:\s+on)?$/.exec(text)
    ?? /\b(dark|light|night)\s+(?:mode|theme)\b/.exec(text)
  if (!match) return null
  const mode = ['dark', 'night'].includes(match[1]) ? 'dark' : 'light'
  return { kind: 'theme', mode, chips: ['Theme', mode === 'dark' ? 'Dark' : 'Light'],
    label: `Switch to the ${mode} theme` }
}

function signOut(text) {
  return /^(?:sign|log)[\s-]?(?:out|off)$|^logout$|^signout$|^sign me out$|^log me out$/.test(text)
    ? { kind: 'signout', chips: ['Sign out'], label: 'Sign out of Scout' } : null
}

function newProject(text, { user }) {
  if (!/\b(?:new|create|add|start|request)\s+(?:a\s+)?project\b/.test(text)) return null
  if (can(user, 'project.create')) return navigate('/projects?new=1', ['Projects', 'New'], 'Create a new project')
  if (can(user, 'request.submit')) return navigate('/requests?new=1', ['Project requests', 'New'], 'Request a new project')
  return null
}

function approvals(text, { user }) {
  if (!/\bapprovals?\b|\bto approve\b|\bapprove hours\b|\bwaiting for (?:my )?approval\b/.test(text)) return null
  return can(user, 'approvals.view')
    ? navigate('/timesheets', ['Timesheets', 'To review'], 'Open the hours waiting for approval') : null
}

function overAllocated(text, { user }) {
  if (!/\b(?:over|above|more than|beyond)\s+40\b|\bover[\s-]?allocated\b|\bovertime\b|\btoo many hours\b/.test(text)) return null
  return mayOpen(user, 'allocation')
    ? navigate('/allocation', ['Allocation', 'Over 40h'], 'See who is over 40 hours this week') : null
}

function overdue(text, { user }) {
  if (!/\boverdue\b|\blate milestones?\b|\bpast due\b/.test(text)) return null
  const onDashboard = user?.role !== 'employee'
  return onDashboard
    ? navigate('/', ['Dashboard', 'Overdue milestones'], 'Open the dashboard deliverables', { milestones: 'overdue' })
    : navigate('/projects?at_risk=true', ['Projects', 'At risk'], 'Open your at-risk projects', { milestones: 'overdue' })
}

const CRITICAL = /^critical(?: priority)?$|\bcritical (?:priority )?(?:milestones?|deliverables?)\b/
const HIGH = /^high[\s-]?priority$|\bhigh[\s-]?priority (?:milestones?|deliverables?)\b|\b(?:urgent|important) (?:milestones?|deliverables?)\b/

/** "critical milestones" / "high priority milestones": the dashboard's deliverables (My week for employees), with
 * the palette listing those milestones, as "overdue milestones" does. */
function priorityMilestones(text, { user }) {
  const level = CRITICAL.test(text) ? 'critical' : HIGH.test(text) ? 'high' : null
  if (!level) return null
  const chip = level === 'critical' ? 'Critical milestones' : 'High priority milestones'
  return user?.role === 'employee'
    ? navigate('/', ['My week', chip], 'Open My week', { milestones: level })
    : navigate('/', ['Dashboard', chip], 'Open the dashboard deliverables', { milestones: level })
}

function budgetOf(text, { projects }) {
  const match = /^(?:show\s+|open\s+)?(?:the\s+)?budget\s+(?:of|for|on)\s+(?:the\s+)?(.+?)(?:\s+project)?$/.exec(text)
    ?? /^(?:show\s+|open\s+)?(?:the\s+)?(.+?)(?:\s+project)?(?:'s|s')?\s+budget$/.exec(text)
  if (!match) return null
  const project = findByName(projects, match[1])
  return project ? navigate(`/projects/${project.id}?tab=budget`, [project.name, 'Budget'], `Open the budget of ${project.name}`) : null
}

function personHours(text, { user, people }) {
  const match = /^(my)\s+(?:hours|timesheet|history|profile|time)$/.exec(text)
    ?? /^(.+?)(?:'s|s')\s+(?:hours|timesheet|history|profile|time)$/.exec(text)
    ?? /^(?:hours|timesheet|history|time)\s+(?:of|for|by)\s+(.+)$/.exec(text)
  if (!match) return null
  const who = match[1].trim()
  if (/^(?:my|me|mine)$/.test(who)) {
    return can(user, 'timesheet.use') ? navigate('/timesheet', ['My timesheet'], 'Open your timesheet')
      : navigate(`/people/${user.id}/profile`, ['My profile'], 'Open your profile')
  }
  const person = findPerson(people, who)
  if (!person || !canViewProfile(user, person.id, person.context)) return null
  const name = fullName(person)
  return navigate(`/people/${person.id}/profile`, [name, 'Hours'], `Open ${name}'s hours and history`)
}

function projectFilters(text, { departments }) {
  const atRisk = AT_RISK.test(text)
  const status = STATUS_WORDS.find(([re]) => re.test(text))
  const department = findDepartment(departments, text)
  const mentionsProjects = /\bprojects?\b/.test(text)
  if (!atRisk && !status && !(department && mentionsProjects)) return null
  const params = new URLSearchParams()
  const chips = ['Projects']
  if (atRisk) { params.set('at_risk', 'true'); chips.push('At risk') }
  if (status) { params.set('status', status[1]); chips.push(status[2]) }
  if (department) { params.set('department', String(department.id)); chips.push(department.name) }
  const qs = params.toString()
  return navigate(`/projects${qs ? `?${qs}` : ''}`, chips, `Open the projects list filtered to ${chips.slice(1).join(', ')}`)
}

const RULES = [theme, signOut, newProject, approvals, overAllocated, overdue, priorityMilestones, budgetOf, personHours,
  projectFilters]

export function parsePhrase(raw, { user, projects = [], people = [], departments = [] } = {}) {
  const text = normalize(raw)
  if (text.length < 2 || !user) return null
  const context = { user, projects, people, departments }
  for (const rule of RULES) {
    const intent = rule(text, context)
    if (intent) return intent
  }
  return null
}

/** Example phrases the palette suggests when it is empty, limited to what the viewer can do. */
export function examplePhrases(user) {
  const list = ['at-risk projects', 'on hold projects']
  if (user?.role !== 'employee') list.push('overdue milestones')
  list.push('critical milestones')
  if (can(user, 'approvals.view')) list.push('pending approvals')
  if (mayOpen(user, 'allocation')) list.push('who is over 40')
  list.push('dark mode')
  return list
}
