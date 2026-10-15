import { z } from 'zod'

// Same rules and codes as the backend (app/security.py password_policy_errors).
export const SPECIALS = `!"#$%&'()*+,-./:;<=>?@[\\]^_\`{|}~`
export const PASSWORD_RULES = [
  { code: 'TOO_SHORT', label: 'At least 6 characters', test: (pw) => pw.length >= 6 },
  { code: 'NEEDS_DIGIT', label: 'At least 1 number', test: (pw) => /\d/.test(pw) },
  { code: 'NEEDS_SPECIAL', label: 'At least 1 special character', test: (pw) => [...pw].some((c) => SPECIALS.includes(c)) },
]

export const passwordRuleErrors = (pw = '') => PASSWORD_RULES.filter((r) => !r.test(pw)).map((r) => r.code)

export const passwordSchema = z.string().refine((pw) => passwordRuleErrors(pw).length === 0,
  { message: "Doesn't meet the password rules yet" })

export const loginSchema = z.object({
  username: z.string().trim().min(1, { message: 'Enter your username' }),
  password: z.string().min(1, { message: 'Enter your password' }),
})

const matching = (data, ctx) => {
  if (data.new_password !== data.confirm_password) {
    ctx.addIssue({ code: 'custom', path: ['confirm_password'], message: "Passwords don't match" })
  }
}

export const newPasswordSchema = z.object({
  new_password: passwordSchema,
  confirm_password: z.string().min(1, { message: 'Confirm your new password' }),
}).superRefine(matching)

export const changePasswordSchema = z.object({
  current_password: z.string().min(1, { message: 'Enter your temporary password' }),
  new_password: passwordSchema,
  confirm_password: z.string().min(1, { message: 'Confirm your new password' }),
}).superRefine((data, ctx) => {
  matching(data, ctx)
  if (data.new_password && data.new_password === data.current_password) {
    ctx.addIssue({ code: 'custom', path: ['new_password'], message: 'Choose a password different from your temporary one' })
  }
})

export const usernameSchema = z.object({ username: z.string().trim().min(1, { message: 'Enter your username' }) })
export const codeSchema = z.object({ code: z.string().regex(/^\d{6}$/, { message: 'Enter the 6-digit code' }) })

const isoDate = (label) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: `Pick a ${label}` })
const money = z.union([z.string(), z.number()])
  .transform((v) => (v === '' || v == null ? 0 : Number(v)))
  .refine((v) => Number.isFinite(v), { message: 'Enter a number' })
  .refine((v) => v >= 0, { message: "Budget can't be negative" })

const endAfterStart = (startKey, endKey) => (data, ctx) => {
  if (data[startKey] && data[endKey] && data[endKey] < data[startKey]) {
    ctx.addIssue({ code: 'custom', path: [endKey], message: 'End date must be on or after the start date' })
  }
}

export const projectSchema = z.object({
  name: z.string().trim().min(1, { message: 'Enter a project name' }).max(120),
  description: z.string().max(4000).optional().default(''),
  start_date: isoDate('start date'),
  predicted_end_date: isoDate('predicted end date'),
  budget: money,
  manager_id: z.string().min(1, { message: 'Pick a manager' }),
  status: z.string().optional(),
  department_id: z.string().optional().default(''),
  work_mode: z.enum(['push', 'pull']),
  delegate_approver_id: z.string().optional().default(''),
  delegate_until: z.string().optional().default(''),
}).superRefine(endAfterStart('start_date', 'predicted_end_date'))

export const requestSchema = z.object({
  name: z.string().trim().min(1, { message: 'Enter a project name' }).max(120),
  description: z.string().max(4000).optional().default(''),
  proposed_start: isoDate('start date'),
  proposed_end: isoDate('end date'),
  proposed_budget: money,
  reason: z.string().trim().min(1, { message: 'Say why this project is needed' }).max(2000),
}).superRefine(endAfterStart('proposed_start', 'proposed_end'))

export const memberSchema = z.object({
  user_id: z.string().min(1, { message: 'Pick a person' }),
  planned_hours_per_week: z.union([z.string(), z.number()]).transform(Number)
    .refine((v) => v > 0, { message: 'More than 0 hours' }).refine((v) => v <= 40, { message: 'At most 40 hours' }),
})

export const milestoneSchema = z.object({
  name: z.string().trim().min(1, { message: 'Enter a milestone name' }).max(120),
  description: z.string().max(4000).optional().default(''),
  start_date: isoDate('start date'),
  end_date: isoDate('end date'),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  predecessor_ids: z.array(z.string()),
  assignee_ids: z.array(z.string()),
}).superRefine(endAfterStart('start_date', 'end_date'))

/** 12 characters with at least one uppercase, lowercase, digit and special character (matches the backend). */
export function generatePassword(length = 12) {
  const pools = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%^&*?-_+=']
  const all = pools.join('')
  const rand = (n) => {
    const buf = new Uint32Array(1)
    globalThis.crypto.getRandomValues(buf)
    return buf[0] % n
  }
  const chars = pools.map((p) => p[rand(p.length)])
  while (chars.length < length) chars.push(all[rand(all.length)])
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = rand(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
