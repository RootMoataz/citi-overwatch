// Puppy's help library: short answers about how Scout works, matched by fixed patterns (no AI). The wording follows
// docs/project/LOGIC_WALKTHROUGH.md; features that may not exist in every build (kickbacks) are described generically.
// Each topic: { topic, title, match: RegExp on the normalized question, text (string or user → string), to?, link? }.

const MESSAGE_RULES = (user) => (user?.role === 'employee'
  ? 'You can message your managers: the person you report to, the manager of each live project you are on, and that '
    + "project's delegate approver while the delegation runs. You can reply in any conversation you are part of."
  : 'You can message anyone active in Scout and start group conversations. Employees can only message their managers, '
    + 'so their questions come up the chain of command. Bell alerts never include the message text.')

export const HELP = [
  { topic: 'puppy', title: 'About Puppy',
    match: /\bwho are you\b|\bwhat are you\b|\bwhat can you do\b|\bare you (?:an? )?(?:ai|bot|robot|real)\b|\bhow do you work\b/,
    text: "I'm Puppy, Scout's helper. I follow fixed rules over data your role already sees: no AI service is involved and "
      + 'nothing you type leaves your browser. I can sum up what needs you, explain how Scout works and, when you confirm, '
      + 'do small things for you.' },
  { topic: 'at-risk', title: 'When is a project at risk?', to: '/projects?at_risk=true', link: 'Open at-risk projects',
    match: /\b(?:how|why|when|explain|what makes)\b.*\bat[\s-]?risk\b|\bat[\s-]?risk\b.*\b(?:rules?|mean|means|calculated|decided|work|works)\b/,
    text: 'A project that is not completed is at risk when any of these is true: a milestone is past its end date and not '
      + 'completed (Overdue milestone); today is after the predicted end date (Past due date); or the % of budget used is '
      + '20 points or more ahead of its weighted progress (Budget burning faster than progress).' },
  { topic: 'progress', title: 'How progress is calculated',
    match: /\bprogress\b.*\b(?:calculated|computed|measured|weighted|work|works|mean|means)\b|\bhow\b.*\bprogress\b|\bdifficult(?:y|ies)\b/,
    text: 'Progress is weighted by difficulty: each completed milestone counts easy 1, medium 2, hard 3, out of the total '
      + 'weight of all the project\'s milestones. A project with no milestones is 0% complete. Priority never changes it.' },
  { topic: 'priority', title: 'What priority does',
    match: /\b(?:how|why)\b.*\bpriorit(?:y|ies)\b|\bwhat (?:does|is|do) (?:a |the )?priorit(?:y|ies)\b|\bpriority (?:mean|means|do|does|work|works|for)\b/,
    text: 'Milestone priority (low, medium, high, critical) decides order: auto-routing picks overdue work first, then '
      + 'critical → low; it sorts My milestones and the palette, and makes due-soon insights more urgent. It never changes '
      + 'progress; that is difficulty\'s job.' },
  { topic: 'overtime', title: 'The 40-hour rule',
    match: /\b(?:overtime|over[\s-]?40|40[\s-]?hours?|40h)\b.*\b(?:work|works|rules?|mean|means|happen|happens)\b|\b40[\s-]?hour rule\b|\bovertime rules?\b|\bhow\b.*\bovertime\b/,
    text: 'Logging more than 40 hours in a week (Monday–Sunday, pending + approved, all projects) is a warning, not a '
      + 'block: the hours above 40 go to your manager as an overtime request, and the manager gets one alert per person per '
      + 'week. Planned hours are different: a person can be planned for at most 40 hours a week across overlapping projects.' },
  { topic: 'day-cap', title: 'Hours per day',
    match: /\b24[\s-]?(?:hours?|h)\b|\bper day\b|\bdaily (?:limit|cap|maximum)\b|\bhours? a day\b/,
    text: 'A day can hold at most 24 hours across all your milestones (pending + approved). Each cell is 0.25–24 hours with '
      + 'up to 2 decimals. The timesheet marks the day that goes over and Save waits until it is fixed.' },
  { topic: 'friday', title: 'The Friday reminder', to: '/timesheet', link: 'Open my timesheet',
    match: /\bfriday\b|\breminders?\b/,
    text: 'From Friday 14:00 (New York time) until the end of Sunday, anyone on an active project with no counted hours that '
      + 'week gets a "timesheet is empty" alert in the bell. Managers and admins also see a Missing timesheets card.' },
  { topic: 'delegate', title: 'Delegate approvers',
    match: /\bdelegat/,
    text: "A project's manager (or an admin) can name another manager or admin as delegate approver, optionally until a "
      + "date. While it runs, the delegate also gets that project's pending hours in Approvals; the manager keeps every right." },
  { topic: 'approvals', title: 'How approvals work', to: '/approvals', link: 'Open Approvals',
    match: /\bhow\b.*\bapprov|\bwho approves\b|\bapproval (?:process|rules?|works?)\b|\bwhat happens\b.*\b(?:approv|reject)/,
    text: "Saved hours are pending until the project's manager (or an active delegate approver) approves them or rejects "
      + 'them with a reason. Nobody approves their own hours. Rejected hours come back to you in the bell to fix and resubmit.' },
  { topic: 'messages', title: 'Who can message whom', to: '/messages', link: 'Open Messages',
    match: /\bwho (?:can|may) i (?:message|write to|talk to|chat with|contact)\b|\bcan i message\b|\bmessag\w* rules?\b|\bchain of command\b/,
    text: MESSAGE_RULES },
  { topic: 'executive', title: 'Executives are read-only',
    match: /\bexecutives?\b|\bread[\s-]?only\b/,
    text: "Executives see what admins see, for oversight, but can't change anything: the server refuses every edit they "
      + 'try. They never see salaries or hourly rates, not even their own.' },
  { topic: 'routing', title: 'Auto-routing and work sent back',
    match: /\bauto[\s-]?rout|\brouting\b|\bkickbacks?\b|\bsent back\b|\bready for review\b|\bsupport(?:ing)? (?:milestones?|work)\b/,
    text: 'When an assignee marks a milestone Ready for review, Scout may add them as support on the most urgent in-progress '
      + 'milestone on their projects (overdue first, then priority, then the nearest end date) if their planned hours fit. '
      + 'If your Scout has kickbacks, work sent back for changes arrives in the bell like any other alert.' },
]

/** The help topic for a normalized question, as an answer for this viewer, or null. */
export function findHelp(text, user) {
  const entry = HELP.find((h) => h.match.test(text))
  if (!entry) return null
  return { kind: 'help', topic: entry.topic, title: entry.title,
    text: typeof entry.text === 'function' ? entry.text(user) : entry.text, to: entry.to ?? null, link: entry.link ?? null }
}
