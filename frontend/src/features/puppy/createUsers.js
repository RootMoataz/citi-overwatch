// "Create user accounts" with Puppy: the rules behind the conversation (CreateUsersChat.jsx), kept here as plain
// functions so they can be tested on their own. Nothing in this file talks to the server by itself: the chat passes in
// the same calls the People page uses (GET /users/username-availability, GET /users, POST /users), and the server
// stays the guard (admin only, the public demo's guard, validation, password policy, audit).
import { EMAIL_RE } from '../../lib/schemas.js'

export const MAX_PEOPLE = 25
/** Pause between accounts, so a batch of 25 doesn't hit the API all at once (tests set it to 0). */
export const timing = { paceMs: 300 }
export const MAX_NAME = 80
const USERNAME_RE = /^[a-z0-9._]{3,20}$/
const USERNAME_MAX = 20

// Puppy's lines, word for word (the docs and the demo script quote them).
export const SAY = {
  names: 'What are the names of the people to add? You can paste several, separated by commas or new lines.',
  lastName: (first) => `What's ${first}'s last name?`,
  usernames: (n) => `Got it: ${n} ${n === 1 ? 'person' : 'people'}. These are their usernames — click one to change it.`,
  emails: 'What are their email addresses? In the same order, please.',
  pairing: 'Thanks! This is who gets which email:',
  role: (name) => `What role should ${name} have?`,
  manager: (name) => `Who will ${name} report to?`,
  department: (name) => `Department for ${name}?`,
  person: (i, n) => `Person ${i} of ${n}`,
  sameAsPrevious: 'Same as previous',
  sameForRest: 'Use the same for everyone left',
  review: (n) => (n === 1
    ? "I'll create this account with a randomly generated temporary password that meets the security rules, and email "
      + "the person their sign-in details. They'll choose their own password at first sign-in. Is that okay?"
    : `I'll create these ${n} accounts with randomly generated temporary passwords that meet the security rules, and `
      + "email each person their sign-in details. They'll choose their own password at first sign-in. Is that okay?"),
  options: 'No problem. What would you like to do instead?',
  cancelled: 'Okay, nothing was created.',
  demo: 'Creating accounts is disabled in the public demo.',
  noNames: "I didn't catch any names. Type one or more, separated by commas or new lines.",
  noEmails: "I didn't catch any email addresses. Type them in the same order as the names.",
  noLastName: 'I need a last name for this one.',
  everyoneRemoved: "Everyone's been removed. Who should I add?",
  relayMissing: "Heads-up: the email relay isn't set up in this browser. If Scout's server can't email either, I'll offer "
    + 'to show each password once instead.',
  running: 'Creating the accounts one by one…',
  waitClose: "I'm still creating the accounts — please wait until I'm done.",
  allShown: "That's every password. They're gone now: if someone loses theirs, use Reset password on their profile.",
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** "a, b; c\n d" → ['a', 'b', 'c', 'd']: commas, semicolons and new lines separate; trimmed; empties dropped. */
export function splitItems(text) {
  return String(text ?? '').split(/[,;\r\n]+/).map((s) => s.trim()).filter(Boolean)
}

const NAME_TOKEN = /^[\p{L}\p{M}'’-]+$/u
// Capitals are added only when the whole answer was typed in lower case ("john.doe"); "Ann van Dyke" stays as typed.
const capital = (t) => t.charAt(0).toUpperCase() + t.slice(1)
const tidy = (s, tokens) => (s === s.toLowerCase() ? tokens.map(capital) : tokens)

/**
 * One typed item → {first, last, typedUsername} or {error: 'email' | 'invalid'}. A space, underscore or dot splits
 * the name: the first token is the first name, the rest the last name. An item without spaces that has a dot,
 * underscore or digit and fits the username rules ("John_Doe3") is also kept as the preferred username.
 */
export function parseName(raw) {
  const s = String(raw ?? '').trim().replace(/\s+/g, ' ')
  if (s.includes('@')) return { error: 'email' }
  const usernameLike = !s.includes(' ') && /[._\d]/.test(s) && /^[A-Za-z0-9._]{3,20}$/.test(s)
  const tokens = s.split(/[\s._]+/).map((t) => (usernameLike ? t.replace(/\d+/g, '') : t)).filter(Boolean)
  if (!tokens.length || !tokens.every((t) => NAME_TOKEN.test(t))) return { error: 'invalid' }
  const names = tidy(s, tokens)
  return { first: names[0], last: names.slice(1).join(' '), typedUsername: usernameLike ? s.toLowerCase() : null }
}

let nextKey = 0
const newKey = () => { nextKey += 1; return `p${nextKey}` }

/** The names answer → {people: [{key, first, last, typedUsername}], problem: string | null}. */
export function parseNames(text) {
  const items = splitItems(text)
  if (!items.length) return { people: [], problem: SAY.noNames }
  if (items.length > MAX_PEOPLE) {
    return { people: [], problem: `That's ${items.length} people — I can add up to ${MAX_PEOPLE} at a time. Please send the `
      + `first ${MAX_PEOPLE} now and the rest afterwards.` }
  }
  const people = []
  for (const item of items) {
    const parsed = parseName(item)
    if (parsed.error === 'email') {
      return { people: [], problem: `"${item}" looks like an email address. Names first, please — I'll ask for emails next.` }
    }
    if (parsed.error) {
      return { people: [], problem: `I couldn't read "${item}" as a name. Names can use letters, spaces, hyphens and apostrophes.` }
    }
    if (parsed.first.length > MAX_NAME || parsed.last.length > MAX_NAME) {
      return { people: [], problem: `"${item.slice(0, 24)}…" is too long — names can be up to ${MAX_NAME} characters.` }
    }
    people.push({ key: newKey(), ...parsed })
  }
  return { people, problem: null }
}

/** A last name typed on its own → the cleaned name, or null. */
export function parseLastName(text) {
  const s = String(text ?? '').trim().replace(/\s+/g, ' ')
  if (!s || s.length > MAX_NAME || !s.split(' ').every((t) => NAME_TOKEN.test(t))) return null
  return tidy(s, s.split(' ')).join(' ')
}

const ascii = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')

/** "John Doe" → "john.doe" (accents dropped, at most 20 characters); '' when the name has no usable letters. */
export function usernameBase({ first, last }) {
  const f = ascii(first)
  const l = ascii(last)
  const base = (f && l ? `${f}.${l}` : f || l).slice(0, USERNAME_MAX).replace(/\.$/, '')
  return USERNAME_RE.test(base) ? base : ''
}

/**
 * The username for one person: the typed one if valid and free, else first.last, else first.last2, 3…, skipping
 * names already taken on the server or chosen earlier in this batch (`batch`). `check(username, first, last)` is
 * GET /users/username-availability; names without usable letters take the server's first unused suggestion.
 */
export async function pickUsername(person, batch, check) {
  const free = async (u) => USERNAME_RE.test(u) && !batch.has(u) && (await check(u, person.first, person.last)).available
  if (person.typedUsername && await free(person.typedUsername)) return person.typedUsername
  const base = usernameBase(person)
  if (base) {
    if (await free(base)) return base
    for (let n = 2; n < 100; n += 1) {
      const candidate = `${base.slice(0, USERNAME_MAX - String(n).length)}${n}`
      if (await free(candidate)) return candidate
    }
  }
  const { suggestions = [] } = await check('', person.first, person.last)
  const pick = suggestions.find((s) => !batch.has(s))
  if (pick) return pick
  for (let n = 2; n < 1000; n += 1) {
    if (await free(`user${n}`)) return `user${n}`
  }
  throw new Error('No free username')
}

/** The emails answer → the addresses in order. Commas, semicolons, new lines or spaces separate them. */
export function parseEmails(text) {
  return splitItems(text).flatMap((item) => {
    const bracketed = /<([^<>]+)>/.exec(item)
    if (bracketed) return [bracketed[1].trim()]
    const pieces = item.split(/\s+/)
    // "a@x.com b@x.com" is two addresses; "not an email" stays one item so Puppy can quote it back.
    return pieces.every((p) => p.includes('@')) ? pieces : [item]
  }).filter(Boolean)
}

const nameOf = (p) => `${p.first} ${p.last}`.trim()

/** Emails against the names: {problem, pairing: [[name | null, email | null], …]}. */
export function checkEmails(emails, people) {
  const pairing = Array.from({ length: Math.max(emails.length, people.length) },
    (_, i) => [people[i] ? nameOf(people[i]) : null, emails[i] ?? null])
  if (!emails.length) return { problem: SAY.noEmails, pairing }
  const bad = emails.filter((e) => !EMAIL_RE.test(e))
  if (bad.length) {
    return { problem: `These don't look like email addresses: ${bad.join(', ')}. Please fix them.`, pairing }
  }
  if (emails.length !== people.length) {
    const tail = emails.length < people.length ? "who's missing?" : 'which one is extra?'
    return { problem: `I got ${plural(emails.length, 'email')} for ${plural(people.length, 'person', 'people')} — ${tail}`, pairing }
  }
  const seen = new Set()
  for (const e of emails) {
    if (seen.has(e.toLowerCase())) return { problem: `${e} appears more than once — each person needs their own email.`, pairing }
    seen.add(e.toLowerCase())
  }
  return { problem: null, pairing }
}

const ROLE_WORDS = [['employee', /\b(?:emp|employees?|staff|team members?)\b/], ['manager', /\bmanagers?\b/],
  ['executive', /\bexec(?:utive)?s?\b/], ['admin', /\badmin(?:istrator)?s?\b/]]

/** A role typed instead of clicked → 'employee' | 'manager' | 'executive' | 'admin' | null. */
export function matchRole(text) {
  const t = String(text ?? '').toLowerCase()
  return ROLE_WORDS.find(([, re]) => re.test(t))?.[0] ?? null
}

/** A manager or department typed instead of picked: the one option whose label contains the text, else null. */
export function matchChoice(text, options) {
  const t = String(text ?? '').trim().toLowerCase()
  if (t.length < 2) return null
  const exact = options.filter((o) => o.label.toLowerCase() === t)
  if (exact.length === 1) return exact[0].id
  const hits = options.filter((o) => o.label.toLowerCase().includes(t))
  return hits.length === 1 ? hits[0].id : null
}

/** Puppy's closing line. mode: 'email' (Yes), 'show' (show each password once) or 'none' (send nothing). */
export function doneMessage({ total, created, emailed = 0, mode, serverEmailed = 0 }) {
  const failed = total - created
  const parts = [failed ? `${created} of ${plural(total, 'account')} created` : `Done! ${plural(created, 'account')} created`]
  let text
  if (mode === 'email') {
    text = `${parts[0]}, ${plural(emailed, 'email')} sent.`
    if (failed) text += ` ${failed} couldn't be created — fix ${failed === 1 ? 'it' : 'them'} and press Retry failed.`
    const unsent = created - emailed
    if (unsent) {
      text += ` ${plural(unsent, 'email')} didn't go out — show the ${unsent === 1 ? 'password' : 'passwords'} once or `
        + `retry the ${unsent === 1 ? 'email' : 'emails'}.`
    }
  } else {
    text = `${parts[0]}.`
    if (failed) text += ` ${failed} couldn't be created — fix ${failed === 1 ? 'it' : 'them'} and press Retry failed.`
    if (serverEmailed) text += ` Scout's server emailed sign-in details to ${plural(serverEmailed, 'of them', 'of them')}.`
    if (mode === 'show') text += " I'll show each password once so you can hand it over yourself."
    else {
      text += " No sign-in details were sent: when you're ready, open each profile and use Reset password to email them."
    }
  }
  return `${text} They'll be asked to choose a password when they first sign in.`
}
