import { describe, expect, test } from 'vitest'
import { users } from '../../test/render.jsx'
import { askPuppy, stripPolite } from './ask.js'

const data = {
  projects: [{ id: 'p1', name: 'Apollo' }],
  people: [{ id: 'u-eli', first_name: 'Eli', last_name: 'Employee', name: 'Eli Employee', context: { managed: true } }],
  departments: [{ id: 'd1', name: 'Technology' }],
}
const ask = (text, user = users.manager) => askPuppy(text, { user, ...data })

describe('Ask Puppy (the command palette\'s phrase rules)', () => {
  test('"what\'s at risk?" opens the at-risk projects', () => {
    expect(ask("what's at risk?")).toMatchObject({ kind: 'navigate', to: '/projects?at_risk=true', answer: 'Projects · At risk' })
  })

  test('"who is over 40?" opens Allocation for a manager; an employee is told Puppy can\'t help there', () => {
    expect(ask('who is over 40?')).toMatchObject({ kind: 'navigate', to: '/allocation', answer: 'Allocation · Over 40h' })
    expect(ask('who is over 40?', users.employee)).toMatchObject({ kind: 'unknown' })
  })

  test('"show critical milestones" opens the deliverables (My week for employees)', () => {
    expect(ask('show critical milestones')).toMatchObject({ kind: 'navigate', to: '/', answer: 'Dashboard · Critical milestones' })
    expect(ask('show critical milestones', users.employee)).toMatchObject({ to: '/', answer: 'My week · Critical milestones' })
  })

  test('greetings and politeness around a question are ignored', () => {
    expect(stripPolite('Hey Puppy, show me pending approvals please!')).toBe('pending approvals')
    expect(ask('Puppy: pending approvals please')).toMatchObject({ to: '/approvals' })
    expect(ask("can you show me Eli's hours?")).toMatchObject({ to: '/people/u-eli/profile' })
    expect(ask('budget of Apollo')).toMatchObject({ to: '/projects/p1?tab=budget' })
  })

  test('theme phrases switch the theme instead of navigating', () => {
    expect(ask('dark mode')).toMatchObject({ kind: 'theme', mode: 'dark' })
  })

  test('anything else is answered honestly with examples the viewer can use', () => {
    const answer = ask('what is the meaning of life')
    expect(answer.kind).toBe('unknown')
    expect(answer.examples).toContain('at-risk projects')
    expect(answer.examples).toContain('who is over 40')
    expect(ask('   ').kind).toBe('empty')
    expect(ask('who is over 40', users.employee).examples).not.toContain('who is over 40')
  })
})
