// "Ask Puppy": fixed rules, run in the browser only. The question is never sent anywhere, stored or logged; it is
// matched here and forgotten. In order:
//   1. do-it-for-me requests → an action the panel asks the viewer to confirm
//   2. pay and private details (salary, rates, passwords, codes, contact details, message text, audit changes) → refused
//   3. "why is <project> at risk?" → that project's reasons, from the project list the viewer already gets
//   4. how-Scout-works questions → the help library (help.js)
//   5. the command palette's phrase rules (features/palette/phrases.js), which already respect the viewer's role
//   6. questions about a person the viewer may not see → "I can't share that"
//   7. anything else → an honest "no rule for that" with examples the viewer can use
import { RISK_LABELS } from '../../lib/labels.js'
import { examplePhrases, findByName, normalize, parsePhrase } from '../palette/phrases.js'
import { findHelp } from './help.js'

export const REFUSE_PRIVATE = 'I keep pay and private details out of reach — ask an admin through the proper page.'
export const REFUSE_PERSON = "I can't share that. Puppy only answers about people your role lets you see."

const LEADING = /^(?:(?:hey|hi|hello|ok|okay)\s+)?(?:puppy\s+)?(?:(?:can|could|would)\s+you\s+)?(?:please\s+)?(?:(?:show|tell|give|find)\s+me\s+)?(?:(?:show|list|find|open)\s+)?/
const TRAILING = /\s+(?:please|thanks|thank you)$/

/** "Hey Puppy, show me pending approvals please!" → "pending approvals". */
export function stripPolite(text) {
  return normalize(text).replace(LEADING, '').replace(TRAILING, '').trim()
}

const ACTIONS = [
  ['mark-read', /\bmark\b.*\b(?:all|everything|them|notifications?|alerts?)\b.*\bread\b|\bmark all read\b|\bclear (?:my |the |all )?(?:notifications|alerts)\b/],
  ['open-timesheet', /\b(?:open|fill|show|start)\b.*\bmy (?:timesheet|hours)\b|\bfill (?:in )?(?:my )?(?:timesheet|hours)\b|\blog my hours\b/],
  ['message-manager', /\b(?:message|write to|talk to|contact|send a message to|email) my manager\b/],
  ['email-report', /\bemail\b.*\breport\b|\breport\b.*\bto me\b|\bsend me (?:the|this) report\b/],
  ['open-at-risk', /\bopen\b.*\bat[\s-]?risk project\b|\bopen\b.*\briskiest project\b/],
  ['sound', /\b(?:change|switch|pick|set|choose)\b.*\b(?:alert |notification )?sounds?\b|\bsound settings\b|\bmute (?:puppy|sounds?|alerts?)\b/],
]

const PRIVATE = new RegExp([
  /\bsalar(?:y|ies)\b|\bwages?\b|\bpay(?:check|slip|roll)?\b|\bpaid\b|\bearn(?:s|ings)?\b/.source,
  /\bhourly rates?\b|\brates? of pay\b|\bbill(?:ing)? rates?\b|\bcost per (?:person|hour|head)\b/.source,
  /\bpasswords?\b|\bpasscodes?\b|\b(?:reset|one[\s-]time|verification|login|security) codes?\b/.source,
  /\be-?mail address(?:es)?\b|'s e-?mails?\b|\bphone\b|\bmobile numbers?\b|\bhome address\b|\bsocial security\b|\bbank\b/.source,
  /\bprivate messages?\b|\bwhat did \w+ (?:say|write|send)\b|\b\w+'s messages\b|\baudit (?:changes|details|payloads?)\b/.source,
].join('|'))

const PERSON = /(?:'s|s')\s+(?:hours|timesheet|history|profile|time)$|^(?:hours|timesheet|history|time)\s+(?:of|for|by)\s+\S/
const WHY_AT_RISK = /^why\s+(?:is|are|'s)?\s*(?:the\s+)?(.+?)(?:\s+project)?\s+(?:at[\s-]?risk|risky|in trouble|flagged)$/

function projectRisk(text, projects, question) {
  const match = WHY_AT_RISK.exec(text.replace(/^why's\s+/, 'why is '))
  if (!match) return null
  const name = match[1].trim()
  const project = findByName(projects, name)
  if (!project) {
    // Echo the name as it was typed (the matching above works on lower case).
    const at = String(question).toLowerCase().indexOf(name)
    const typed = at >= 0 ? String(question).slice(at, at + name.length) : name
    return { kind: 'help', topic: 'project-risk', to: null,
      text: `I can't find a project called "${typed}" that you can see. Projects are at risk when a milestone is overdue, `
        + 'the predicted end date has passed, or budget runs 20 points ahead of progress.' }
  }
  const reasons = (project.at_risk_reasons ?? []).map((r) => RISK_LABELS[r] ?? r)
  return { kind: 'help', topic: 'project-risk', to: `/projects/${project.id}`, link: `Open ${project.name}`,
    text: reasons.length ? `${project.name} is at risk because: ${reasons.join('; ')}.` : `${project.name} isn't at risk right now.` }
}

/**
 * (question, {user, projects, people, departments}) → one of
 *   {kind: 'action', action}                      a do-it-for-me request (the panel confirms before doing anything)
 *   {kind: 'refuse', text}                        private details, or a person the viewer may not see
 *   {kind: 'help', topic, text, to?, link?}       an explanation
 *   {kind: 'navigate' | 'theme' | 'signout', answer, label, to?, mode?}   the palette's phrase rules
 *   {kind: 'unknown', examples} | {kind: 'empty'}
 */
export function askPuppy(question, context = {}) {
  const text = stripPolite(question)
  const whole = normalize(question)
  if (!whole) return { kind: 'empty' }
  const action = ACTIONS.find(([, re]) => re.test(whole))
  if (action) return { kind: 'action', action: action[0] }
  if (PRIVATE.test(whole)) return { kind: 'refuse', text: REFUSE_PRIVATE }
  const risk = projectRisk(whole, context.projects ?? [], question)
  if (risk) return risk
  const help = findHelp(whole, context.user)
  if (help) return help
  const intent = parsePhrase(question, context) ?? parsePhrase(text, context)
  if (intent) return { ...intent, answer: intent.chips.join(' · ') }
  if (PERSON.test(text)) return { kind: 'refuse', text: REFUSE_PERSON }
  return { kind: 'unknown', examples: examplePhrases(context.user) }
}
