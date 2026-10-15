import { describe, expect, test } from 'vitest'
import {
  MAX_PEOPLE, SAY, checkEmails, doneMessage, matchChoice, matchRole, parseEmails, parseName, parseNames, pickUsername,
  splitItems, usernameBase,
} from './createUsers.js'

describe('splitting what the admin typed', () => {
  test('commas, semicolons and new lines separate items; spaces are trimmed and empties ignored', () => {
    expect(splitItems(' John Doe, Jane Roe ;\n\nAda Lovelace,, ;\r\n  ')).toEqual(['John Doe', 'Jane Roe', 'Ada Lovelace'])
    expect(splitItems('')).toEqual([])
    expect(splitItems(null)).toEqual([])
  })
})

describe('reading names', () => {
  test('a space, underscore or dot splits first from last; the first token is the first name', () => {
    expect(parseName('John Doe')).toEqual({ first: 'John', last: 'Doe', typedUsername: null })
    expect(parseName('John_Doe')).toEqual({ first: 'John', last: 'Doe', typedUsername: 'john_doe' })
    expect(parseName('john.doe')).toEqual({ first: 'John', last: 'Doe', typedUsername: 'john.doe' })
    expect(parseName('Mary Ann van Dyke')).toEqual({ first: 'Mary', last: 'Ann van Dyke', typedUsername: null })
    expect(parseName("  Seán   O'Brien-Smith ")).toEqual({ first: 'Seán', last: "O'Brien-Smith", typedUsername: null })
  })

  test('something that looks like a username keeps a username derived from it; digits are not part of the name', () => {
    expect(parseName('John_Doe3')).toEqual({ first: 'John', last: 'Doe', typedUsername: 'john_doe3' })
    expect(parseName('jdoe2')).toEqual({ first: 'Jdoe', last: '', typedUsername: 'jdoe2' })
  })

  test('a single word is a first name only', () => {
    expect(parseName('Cher')).toEqual({ first: 'Cher', last: '', typedUsername: null })
  })

  test('emails and symbols are not names', () => {
    expect(parseName('john@example.com')).toEqual({ error: 'email' })
    expect(parseName('J0hn $mith!')).toEqual({ error: 'invalid' })
    expect(parseName('123')).toEqual({ error: 'invalid' })
  })

  test('parseNames treats every comma or line as one person, so "Doe, John" is two people', () => {
    const { people } = parseNames('Doe, John')
    expect(people.map((p) => p.first)).toEqual(['Doe', 'John'])
    expect(people.every((p) => p.last === '')).toBe(true)
  })

  test('parseNames explains what is wrong', () => {
    expect(parseNames('  ,\n ').problem).toBe(SAY.noNames)
    expect(parseNames('John Doe, jane@example.com').problem)
      .toBe('"jane@example.com" looks like an email address. Names first, please — I\'ll ask for emails next.')
    expect(parseNames('John Doe, R2-D2!').problem)
      .toBe('I couldn\'t read "R2-D2!" as a name. Names can use letters, spaces, hyphens and apostrophes.')
    const many = Array.from({ length: MAX_PEOPLE + 1 }, (_, i) => `Person${String.fromCharCode(65 + (i % 26))} Test`).join(', ')
    expect(parseNames(many).problem).toBe("That's 26 people — I can add up to 25 at a time. Please send the first 25 now and the rest afterwards.")
    expect(parseNames('A'.repeat(81)).problem).toMatch(/too long/)
  })

  test('25 people is fine; every person gets a stable key', () => {
    const list = Array.from({ length: 25 }, (_, i) => `Person Number${String.fromCharCode(65 + i)}`).join('\n')
    const { people, problem } = parseNames(list)
    expect(problem).toBeNull()
    expect(people).toHaveLength(25)
    expect(new Set(people.map((p) => p.key)).size).toBe(25)
  })
})

describe('usernames', () => {
  test('the base is first.last in lower case, accents dropped, at most 20 characters', () => {
    expect(usernameBase({ first: 'John', last: 'Doe' })).toBe('john.doe')
    expect(usernameBase({ first: 'Seán', last: "O'Brien-Smith" })).toBe('sean.obriensmith')
    expect(usernameBase({ first: 'Maximilian', last: 'Throckmorton-Featherstonehaugh' })).toHaveLength(20)
    expect(usernameBase({ first: '李', last: '王' })).toBe('')
  })

  const server = (taken) => async (username) => ({ username, valid: /^[a-z0-9._]{3,20}$/.test(username),
    available: /^[a-z0-9._]{3,20}$/.test(username) && !taken.includes(username), suggestions: ['user1', 'user2'] })

  test('the first free one, skipping names already taken on the server and earlier in the batch', async () => {
    expect(await pickUsername({ first: 'John', last: 'Doe' }, new Set(), server([]))).toBe('john.doe')
    expect(await pickUsername({ first: 'John', last: 'Doe' }, new Set(['john.doe']), server([]))).toBe('john.doe2')
    expect(await pickUsername({ first: 'John', last: 'Doe' }, new Set(['john.doe2']), server(['john.doe']))).toBe('john.doe3')
  })

  test('a typed username is kept when it is valid and free, else Puppy falls back to the name', async () => {
    expect(await pickUsername({ first: 'John', last: 'Doe', typedUsername: 'john_doe3' }, new Set(), server([]))).toBe('john_doe3')
    expect(await pickUsername({ first: 'John', last: 'Doe', typedUsername: 'john_doe3' }, new Set(), server(['john_doe3'])))
      .toBe('john.doe')
  })

  test('names with no usable letters take the server\'s suggestion', async () => {
    expect(await pickUsername({ first: '李', last: '王' }, new Set(['user1']), server([]))).toBe('user2')
  })
})

describe('reading emails', () => {
  test('commas, semicolons, new lines or spaces separate them; "Name <email>" keeps the address', () => {
    expect(parseEmails('a@example.com, b@example.com;c@example.com\n d@example.com e@example.com'))
      .toEqual(['a@example.com', 'b@example.com', 'c@example.com', 'd@example.com', 'e@example.com'])
    expect(parseEmails('John Doe <john@example.com>, Jane <jane@example.com>')).toEqual(['john@example.com', 'jane@example.com'])
  })

  const people = [{ first: 'John', last: 'Doe' }, { first: 'Jane', last: 'Roe' }, { first: 'Ada', last: 'Lovelace' }]

  test('the count must match the names, and Puppy shows the pairing', () => {
    const fewer = checkEmails(['john@example.com', 'jane@example.com'], people)
    expect(fewer.problem).toBe("I got 2 emails for 3 people — who's missing?")
    expect(fewer.pairing).toEqual([['John Doe', 'john@example.com'], ['Jane Roe', 'jane@example.com'], ['Ada Lovelace', null]])
    const more = checkEmails(['a@example.com', 'b@example.com', 'c@example.com', 'd@example.com'], people)
    expect(more.problem).toBe('I got 4 emails for 3 people — which one is extra?')
    expect(more.pairing.at(-1)).toEqual([null, 'd@example.com'])
    expect(checkEmails(['a@example.com'], [people[0], people[1]]).problem).toBe("I got 1 email for 2 people — who's missing?")
  })

  test('format and duplicates (any capitals) are checked', () => {
    expect(checkEmails(['john@example', 'jane@example.com', 'not an email'], people).problem)
      .toBe("These don't look like email addresses: john@example, not an email. Please fix them.")
    expect(checkEmails(['a@example.com', 'A@Example.com', 'c@example.com'], people).problem)
      .toBe('A@Example.com appears more than once — each person needs their own email.')
    expect(checkEmails([], people).problem).toBe(SAY.noEmails)
    expect(checkEmails(['a@example.com', 'b@example.com', 'c@example.com'], people))
      .toEqual({ problem: null, pairing: [['John Doe', 'a@example.com'], ['Jane Roe', 'b@example.com'], ['Ada Lovelace', 'c@example.com']] })
  })
})

describe('quick replies typed instead of clicked', () => {
  test('roles', () => {
    expect(matchRole('Employee')).toBe('employee')
    expect(matchRole('employees please')).toBe('employee')
    expect(matchRole('emp')).toBe('employee')
    expect(matchRole('managers')).toBe('manager')
    expect(matchRole('exec')).toBe('executive')
    expect(matchRole('Administrator')).toBe('admin')
    expect(matchRole('chef')).toBeNull()
  })

  test('a manager or department by name', () => {
    const options = [{ id: 'm1', label: 'Morgan Manager' }, { id: 'm2', label: 'Avery Admin' }]
    expect(matchChoice('morgan', options)).toBe('m1')
    expect(matchChoice('Avery Admin', options)).toBe('m2')
    expect(matchChoice('nobody here', options)).toBeNull()
    expect(matchChoice('a', options)).toBeNull() // ambiguous
  })
})

describe('per-person questions', () => {
  test('each question names the person', () => {
    expect(SAY.role('John Doe')).toBe('What role should John Doe have?')
    expect(SAY.manager('John Doe')).toBe('Who will John Doe report to?')
    expect(SAY.department('John Doe')).toBe('Department for John Doe?')
    expect(SAY.person(2, 4)).toBe('Person 2 of 4')
  })
})

describe('the closing line', () => {
  test('everything went through', () => {
    expect(doneMessage({ total: 4, created: 4, emailed: 4, mode: 'email' }))
      .toBe("Done! 4 accounts created, 4 emails sent. They'll be asked to choose a password when they first sign in.")
    expect(doneMessage({ total: 1, created: 1, emailed: 1, mode: 'email' }))
      .toBe("Done! 1 account created, 1 email sent. They'll be asked to choose a password when they first sign in.")
  })

  test('a local copy says the emails went to the outbox, not an inbox', () => {
    expect(doneMessage({ total: 2, created: 2, emailed: 0, outboxed: 2, mode: 'email' }))
      .toBe('Done! 2 accounts created, 0 emails sent. This is a local copy, so 2 emails went to the local outbox folder '
        + "instead of an inbox. They'll be asked to choose a password when they first sign in.")
  })

  test('partial failures say what is left', () => {
    expect(doneMessage({ total: 4, created: 3, emailed: 2, mode: 'email' }))
      .toBe("3 of 4 accounts created, 2 emails sent. 1 couldn't be created — fix it and press Retry failed. "
        + "1 email didn't go out — show the password once or retry the email. "
        + "They'll be asked to choose a password when they first sign in.")
  })

  test('show-once and no-email modes', () => {
    expect(doneMessage({ total: 2, created: 2, emailed: 0, mode: 'show' }))
      .toBe("Done! 2 accounts created. I'll show each password once so you can hand it over yourself. "
        + "They'll be asked to choose a password when they first sign in.")
    expect(doneMessage({ total: 2, created: 2, emailed: 0, mode: 'none' }))
      .toBe("Done! 2 accounts created. No sign-in details were sent: when you're ready, open each profile and use "
        + "Reset password to email them. They'll be asked to choose a password when they first sign in.")
  })
})
