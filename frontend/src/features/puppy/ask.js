// "Ask Puppy": the command palette's phrase rules (features/palette/phrases.js), with the chatty bits people type
// to a mascot ("hey Puppy, can you show me … please?") stripped first. No AI: an unmatched question gets an honest
// "I don't know that one" and examples the viewer can actually use.
import { examplePhrases, normalize, parsePhrase } from '../palette/phrases.js'

const LEADING = /^(?:(?:hey|hi|hello|ok|okay)\s+)?(?:puppy\s+)?(?:(?:can|could|would)\s+you\s+)?(?:please\s+)?(?:(?:show|tell|give|find)\s+me\s+)?(?:(?:show|list|find|open)\s+)?/
const TRAILING = /\s+(?:please|thanks|thank you)$/

/** "Hey Puppy, show me pending approvals please!" → "pending approvals". */
export function stripPolite(text) {
  return normalize(text).replace(LEADING, '').replace(TRAILING, '').trim()
}

/**
 * (question, {user, projects, people, departments}) →
 *   {kind: 'navigate', to, answer, label, milestones?} | {kind: 'theme' | 'signout', answer, label, mode?}
 *   | {kind: 'unknown', examples} | {kind: 'empty'}
 */
export function askPuppy(question, context = {}) {
  if (!normalize(question)) return { kind: 'empty' }
  const intent = parsePhrase(question, context) ?? parsePhrase(stripPolite(question), context)
  if (!intent) return { kind: 'unknown', examples: examplePhrases(context.user) }
  return { ...intent, answer: intent.chips.join(' · ') }
}
