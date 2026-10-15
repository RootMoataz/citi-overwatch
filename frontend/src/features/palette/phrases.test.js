import { describe, expect, test } from 'vitest'
import { users } from '../../test/render.jsx'
import { examplePhrases, findByName, normalize, parsePhrase } from './phrases.js'
import { actionsFor, pagesFor, rank, score } from './search.js'

const projects = [
  { id: 'p-apollo', name: 'Apollo' },
  { id: 'p-apollo2', name: 'Apollo Data Platform' },
  { id: 'p-zeus', name: 'Zeus Billing' },
]
const departments = [{ id: 'd-tech', name: 'Technology' }, { id: 'd-ops', name: 'Operations' }, { id: 'd-ds', name: 'Data Science' }]
const eli = { id: 'u-emp', first_name: 'Eli', last_name: 'Employee', name: 'Eli Employee', context: { managed: true } }
const fay = { id: 'u-fay', first_name: 'Fay', last_name: 'Field', name: 'Fay Field' }
const people = [eli, fay]
const data = { projects, departments, people }
const as = (role) => ({ user: users[role], ...data })
const parse = (text, role = 'admin') => parsePhrase(text, as(role))

describe('normalize', () => {
  test('lower-cases, straightens quotes and drops punctuation', () => {
    expect(normalize('  Eli’s   HOURS?! ')).toBe("eli's hours")
    expect(normalize('At-risk, projects.')).toBe('at-risk projects')
    expect(normalize(null)).toBe('')
  })
})

describe('project filters', () => {
  test('at-risk projects', () => {
    expect(parse('at-risk projects')).toMatchObject({ kind: 'navigate', to: '/projects?at_risk=true', chips: ['Projects', 'At risk'] })
    expect(parse('at risk')).toMatchObject({ to: '/projects?at_risk=true' })
    expect(parse('Which projects are risky?')).toMatchObject({ to: '/projects?at_risk=true' })
  })

  test('at-risk projects in a department', () => {
    expect(parse('at-risk projects in Technology')).toMatchObject({
      to: '/projects?at_risk=true&department=d-tech', chips: ['Projects', 'At risk', 'Technology'] })
  })

  test('the longest department name wins', () => {
    expect(parse('projects in data science').to).toBe('/projects?department=d-ds')
  })

  test('a department alone only filters when projects are mentioned', () => {
    expect(parse('projects in operations')).toMatchObject({ to: '/projects?department=d-ops', chips: ['Projects', 'Operations'] })
    expect(parse('operations')).toBeNull()
  })

  test('statuses', () => {
    expect(parse('on hold')).toMatchObject({ to: '/projects?status=on_hold', chips: ['Projects', 'On hold'] })
    expect(parse('on-hold projects')).toMatchObject({ to: '/projects?status=on_hold' })
    expect(parse('completed projects')).toMatchObject({ to: '/projects?status=completed' })
    expect(parse('active projects in Technology')).toMatchObject({ to: '/projects?status=active&department=d-tech' })
    expect(parse('planned projects')).toMatchObject({ to: '/projects?status=planned' })
  })

  test('risk and status together', () => {
    expect(parse('active at risk projects').to).toBe('/projects?at_risk=true&status=active')
  })

  test('every role may filter projects (the list is already scoped to them)', () => {
    expect(parse('at-risk projects', 'employee')).toMatchObject({ to: '/projects?at_risk=true' })
  })
})

describe('people', () => {
  test("Eli's hours and hours for Eli open Eli's profile", () => {
    for (const text of ["Eli's hours", 'hours for Eli', 'eli employee’s hours', "Eli's history", 'timesheet of eli']) {
      expect(parse(text)).toMatchObject({ kind: 'navigate', to: '/people/u-emp/profile', chips: ['Eli Employee', 'Hours'] })
    }
  })

  test('a manager reaches their own people but not others', () => {
    expect(parse("Eli's hours", 'manager')).toMatchObject({ to: '/people/u-emp/profile' })
    expect(parse("Fay's hours", 'manager')).toBeNull()
  })

  test('an employee only reaches themselves', () => {
    expect(parse("Fay's hours", 'employee')).toBeNull()
    expect(parse("Eli's hours", 'employee')).toMatchObject({ to: '/people/u-emp/profile' })
  })

  test('my hours opens the timesheet, or the profile for executives', () => {
    expect(parse('my hours', 'employee')).toMatchObject({ to: '/timesheet' })
    expect(parse('my hours', 'executive')).toMatchObject({ to: '/people/u-exec/profile' })
  })

  test('nobody by that name', () => {
    expect(parse("Zed's hours")).toBeNull()
  })
})

describe('budget', () => {
  test('budget of a project opens its budget tab', () => {
    expect(parse('budget of Apollo')).toMatchObject({ to: '/projects/p-apollo?tab=budget', chips: ['Apollo', 'Budget'] })
    expect(parse("Apollo's budget")).toMatchObject({ to: '/projects/p-apollo?tab=budget' })
    expect(parse('budget for zeus')).toMatchObject({ to: '/projects/p-zeus?tab=budget' })
    expect(parse('show the budget for the apollo data platform project')).toMatchObject({ to: '/projects/p-apollo2?tab=budget' })
  })

  test('an unknown project gives nothing', () => {
    expect(parse('budget of Hermes')).toBeNull()
  })
})

describe('pages and actions by role', () => {
  test('pending approvals for approvers only', () => {
    expect(parse('pending approvals', 'manager')).toMatchObject({ to: '/approvals', chips: ['Approvals', 'Pending'] })
    expect(parse('approvals', 'admin')).toMatchObject({ to: '/approvals' })
    expect(parse('approvals', 'employee')).toBeNull()
    expect(parse('approvals', 'executive')).toBeNull()
  })

  test('who is over 40 opens allocation for those who may see it', () => {
    expect(parse('who is over 40', 'manager')).toMatchObject({ to: '/allocation', chips: ['Allocation', 'Over 40h'] })
    expect(parse('over-allocated people', 'executive')).toMatchObject({ to: '/allocation' })
    expect(parse('who is over 40', 'employee')).toBeNull()
  })

  test('overdue milestones: dashboard deliverables, or at-risk projects for employees', () => {
    expect(parse('overdue milestones', 'manager')).toMatchObject({ to: '/', chips: ['Dashboard', 'Overdue milestones'], milestones: 'overdue' })
    expect(parse('overdue milestones', 'employee')).toMatchObject({ to: '/projects?at_risk=true', milestones: 'overdue' })
  })

  test('critical and high priority milestones: dashboard deliverables, or My week for employees', () => {
    expect(parse('critical milestones', 'manager')).toMatchObject({ to: '/', chips: ['Dashboard', 'Critical milestones'], milestones: 'critical' })
    expect(parse('critical', 'admin')).toMatchObject({ milestones: 'critical' })
    expect(parse('show critical deliverables', 'executive')).toMatchObject({ to: '/', milestones: 'critical' })
    expect(parse('high priority milestones', 'manager')).toMatchObject({ to: '/', chips: ['Dashboard', 'High priority milestones'], milestones: 'high' })
    expect(parse('high-priority', 'manager')).toMatchObject({ milestones: 'high' })
    expect(parse('urgent milestones', 'admin')).toMatchObject({ milestones: 'high' })
    expect(parse('critical milestones', 'employee')).toMatchObject({ to: '/', chips: ['My week', 'Critical milestones'], milestones: 'critical' })
    expect(parse('high', 'manager')?.milestones).toBeUndefined()
  })

  test('new project: admins create, managers request, others nothing', () => {
    expect(parse('new project', 'admin')).toMatchObject({ to: '/projects?new=1' })
    expect(parse('create a project', 'manager')).toMatchObject({ to: '/requests?new=1' })
    expect(parse('new project', 'employee')).toBeNull()
    expect(parse('new project', 'executive')).toBeNull()
  })

  test('theme', () => {
    expect(parse('dark mode')).toMatchObject({ kind: 'theme', mode: 'dark', chips: ['Theme', 'Dark'] })
    expect(parse('switch to light mode')).toMatchObject({ kind: 'theme', mode: 'light' })
    expect(parse('dark')).toMatchObject({ kind: 'theme', mode: 'dark' })
    expect(parse('night theme')).toMatchObject({ kind: 'theme', mode: 'dark' })
  })

  test('sign out', () => {
    for (const text of ['sign out', 'Log out', 'logout', 'sign-out']) expect(parse(text)).toMatchObject({ kind: 'signout' })
  })

  test('plain words are left to the search results', () => {
    expect(parse('apollo')).toBeNull()
    expect(parse('a')).toBeNull()
    expect(parsePhrase('at risk', { projects })).toBeNull()  // nobody signed in
  })

  test('example phrases fit the role', () => {
    expect(examplePhrases(users.employee)).not.toContain('pending approvals')
    expect(examplePhrases(users.manager)).toEqual(expect.arrayContaining(['pending approvals', 'who is over 40']))
  })
})

describe('search', () => {
  test('findByName prefers exact, then prefix, then contains', () => {
    expect(findByName(projects, 'apollo').id).toBe('p-apollo')
    expect(findByName(projects, 'apollo d').id).toBe('p-apollo2')
    expect(findByName(projects, 'billing').id).toBe('p-zeus')
    expect(findByName(projects, '')).toBeNull()
  })

  test('score ranks exact over prefix over word over contains over keyword', () => {
    expect(score('projects', 'Projects')).toBe(100)
    expect(score('proj', 'Projects')).toBe(80)
    expect(score('time', 'My timesheet')).toBe(60)
    expect(score('sheet', 'My timesheet')).toBe(40)
    expect(score('workload', 'Allocation', 'workload capacity')).toBe(20)
    expect(score('zzz', 'Allocation')).toBe(0)
  })

  test('pages follow the route roles', () => {
    const labels = (role) => pagesFor(users[role]).map((p) => p.label)
    expect(labels('employee')).toEqual(expect.arrayContaining(['My week', 'Projects', 'My timesheet', 'My history']))
    expect(labels('employee')).not.toEqual(expect.arrayContaining(['Approvals']))
    expect(labels('employee')).not.toContain('Audit log')
    expect(labels('manager')).toEqual(expect.arrayContaining(['Approvals', 'Allocation', 'Project requests', 'Archive']))
    expect(labels('manager')).not.toContain('People')
    expect(labels('executive')).toEqual(expect.arrayContaining(['Audit log', 'Allocation']))
    expect(labels('executive')).not.toContain('My timesheet')
    expect(labels('admin')).toEqual(expect.arrayContaining(['Control centre', 'People', 'Departments', 'Audit log']))
  })

  test('actions follow permissions and the current theme', () => {
    const ids = (role, mode) => actionsFor(users[role], mode).map((a) => a.label)
    expect(ids('admin', 'light')).toEqual(['New project', 'Log my hours', 'Switch to dark mode', 'Sign out'])
    expect(ids('manager', 'dark')).toContain('Request a new project')
    expect(ids('executive', 'dark')).toEqual(['Switch to light mode', 'Sign out'])
  })

  test('rank groups results in order and drops non-matches', () => {
    const items = [
      { id: 'a', group: 'Actions', label: 'Sign out' },
      { id: 'p', group: 'Projects', label: 'Apollo' },
      { id: 'g', group: 'Pages', label: 'Approvals' },
      { id: 'm', group: 'Milestones', label: 'Schema Mapping', detail: 'Apollo' },
    ]
    expect(rank('ap', items).map((i) => i.id)).toEqual(['g', 'p', 'm'])
  })
})
