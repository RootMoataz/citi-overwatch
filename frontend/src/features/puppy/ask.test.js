import { describe, expect, test } from 'vitest'
import { users } from '../../test/render.jsx'
import { askPuppy, stripPolite } from './ask.js'

const data = {
  projects: [{ id: 'p1', name: 'Apollo', at_risk_reasons: [] },
    { id: 'p2', name: 'Atlas Customer Portal', at_risk_reasons: ['PAST_DUE', 'OVERDUE_MILESTONE'] }],
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
    expect(ask('Puppy: pending approvals please')).toMatchObject({ to: '/timesheets' })
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

describe('Ask Puppy: refusals (pay and private details stay out of reach)', () => {
  test.each([
    "what's Eli's salary?", 'what is my hourly rate', 'how much is Morgan paid', 'give me the reset code',
    "what's Morgan's email address", "Eli's phone number", 'show me private messages', 'what did Morgan write',
    "read Ana's messages", 'show the audit changes', 'what is the temporary password',
  ])('"%s" is refused politely', (question) => {
    for (const user of Object.values(users)) {
      const answer = ask(question, user)
      expect(answer.kind).toBe('refuse')
      expect(answer.text).toBe('I keep pay and private details out of reach — ask an admin through the proper page.')
    }
  })

  test("about people the viewer may not see, Puppy can't share anything", () => {
    // An employee only ever sees themselves.
    expect(askPuppy("Eli's hours", { user: users.employee, ...data, people: [{ ...users.employee, name: 'Eli Employee' }] }))
      .toMatchObject({ to: `/people/${users.employee.id}/profile` })
    expect(askPuppy("Morgan's hours", { user: users.employee, ...data })).toMatchObject({ kind: 'refuse',
      text: "I can't share that. Puppy only answers about people your role lets you see." })
    expect(askPuppy('hours of Ana', { user: users.manager, ...data, people: [] })).toMatchObject({ kind: 'refuse' })
  })
})

describe('Ask Puppy: the help library', () => {
  test.each([
    ['how is progress calculated?', 'progress', /easy 1, medium 2, hard 3/],
    ['how does the at-risk rule work?', 'at-risk', /20 points/],
    ['what does priority do?', 'priority', /never changes progress/],
    ['how does overtime work?', 'overtime', /warning, not a block/],
    ['can I log more than 24 hours a day?', 'day-cap', /24 hours/],
    ['how do approvals work?', 'approvals', /approves their own/],
    ['when is the Friday reminder?', 'friday', /Friday 14:00/],
    ['who can approve as a delegate?', 'delegate', /delegate approver/],
    ['what can executives do?', 'executive', /can't change anything/],
    ['how does auto-routing work?', 'routing', /Ready for review/],
    ['what are kickbacks?', 'kickback', /kicks the milestone back/],
    ['how does auto-routing use skills?', 'routing', /skills only goes to someone/],
    ['how do I finalize the plan?', 'planning', /every card is scheduled/],
    ['are you an AI?', 'puppy', /fixed rules/],
  ])('"%s" → %s', (question, topic, text) => {
    const answer = ask(question)
    expect(answer).toMatchObject({ kind: 'help', topic })
    expect(answer.text).toMatch(text)
  })

  test('"who can I message?" depends on the role', () => {
    expect(ask('who can I message?', users.employee).text).toMatch(/your managers/)
    expect(ask('who can I message?', users.manager).text).toMatch(/anyone active/)
  })

  test('"why is Atlas at risk?" gives that project\'s own reasons, from data the viewer already sees', () => {
    expect(ask('why is Atlas at risk?')).toMatchObject({ kind: 'help', topic: 'project-risk', to: '/projects/p2',
      text: 'Atlas Customer Portal is at risk because: Past due date; Overdue milestone.' })
    expect(ask('why is Apollo at risk?').text).toBe("Apollo isn't at risk right now.")
    expect(ask('why is Zeus at risk?').text).toMatch(/can't find a project called "Zeus" that you can see/)
  })

  test('plain filter phrases still navigate rather than explain', () => {
    expect(ask("what's at risk?")).toMatchObject({ kind: 'navigate' })
    expect(ask('high priority milestones')).toMatchObject({ kind: 'navigate' })
  })
})

describe('Ask Puppy: do-it-for-me requests become actions (confirmed in the panel)', () => {
  test.each([
    ['mark all notifications as read', 'mark-read'],
    ['fill my timesheet', 'open-timesheet'],
    ['message my manager', 'message-manager'],
    ['email me this report', 'email-report'],
    ['open the at-risk project', 'open-at-risk'],
    ['change the alert sound', 'sound'],
  ])('"%s" → %s', (question, action) => {
    expect(ask(question)).toMatchObject({ kind: 'action', action })
  })
})
