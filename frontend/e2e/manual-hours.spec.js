import { expect, test } from '@playwright/test'
import { DEMO_PASSWORD, signIn, signOut } from './helpers.js'

// Ben (desktop) and Ana (mobile) log hours on last week's Sunday, a day the seed leaves empty that is always inside the
// 7-day window (Monday is at most 6 days back). That keeps this journey out of the overtime journey's week (45h).
// Last week's Saturday is typed into the grid, which has no window, so the person has a To review card for that week.
const PERSON = {
  desktop: { username: 'ben.okafor', name: 'Ben Okafor', first: 'Ben' },
  mobile: { username: 'ana.ruiz', name: 'Ana Ruiz', first: 'Ana' },
}
const MILESTONE = 'Schema Mapping'

test.use({ contextOptions: { reducedMotion: 'reduce' } })

const nyToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
const shift = (iso, days) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}
const thisMonday = () => {
  const today = nyToday()
  const [y, m, d] = today.split('-').map(Number)
  return shift(today, -((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7))
}
const parts = (iso) => {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return {
    day: dt.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
    month: dt.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }),
    d,
  }
}
/** "Sun 11 Oct", as formatDayShort. */
const shortDay = (iso) => { const p = parts(iso); return `${p.day} ${p.d} ${p.month}` }
/** "Sun Oct 11", as formatDayLabel. */
const dayLabel = (iso) => { const p = parts(iso); return `${p.day} ${p.month} ${p.d}` }

const MANUAL_DAY = shift(thisMonday(), -1)   // last week's Sunday
const TYPED_DAY = shift(thisMonday(), -2)    // last week's Saturday
const LAST_MONDAY = shift(thisMonday(), -7)
const sheet = (day) => `/timesheet?week=${LAST_MONDAY}&day=${day}`

/** A word in the Day view's panel (the week totals beside it repeat the status words). */
const inDay = (page, text) => page.getByRole('region').getByText(text, { exact: true })

async function openBell(page) {
  await page.getByRole('button', { name: /^Notifications, \d+ unread/ }).click()
}

/** The request's row (a table row on a desktop, a card on a phone). */
const requestRow = (page, name) => page.locator('tr, article').filter({ hasText: name }).filter({ hasText: shortDay(MANUAL_DAY) }).last()

test.describe.serial('manual hours', () => {
  test('employee logs manual hours from My week → not in To review → week approval leaves it → manager approves from Manual hours → employee sees Approved', async ({ page, request }, testInfo) => {
    test.slow() // four sign-ins and two screens per person
    const person = PERSON[testInfo.project.name]
    const short = shortDay(MANUAL_DAY)

    // The employee logs hours from My week.
    await signIn(page, person.username)
    await page.goto('/')
    const button = page.getByRole('button', { name: `Log hours manually on ${MILESTONE}` }).first()
    await expect(button).toBeVisible()
    await button.click()
    const dialog = page.getByRole('dialog', { name: 'Log hours manually' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('combobox', { name: 'Day' }).click()
    await page.getByRole('option', { name: new RegExp(`${short}$`) }).click()
    await dialog.getByLabel('Hours').fill('2')
    await dialog.getByRole('radio', { name: 'Forgot to start the timer' }).check()
    await dialog.getByLabel('Work note').fill('Mapped the legacy address fields offline.')
    await dialog.getByRole('button', { name: 'Send for review' }).click()
    await expect(page.getByText(`Sent 2h on ${MILESTONE} (${short}) for review`)).toBeVisible()

    // The cell is read-only; a typed day beside it needs no reason.
    await page.goto(sheet(MANUAL_DAY))
    await expect(inDay(page, 'Pending')).toBeVisible()
    await expect(inDay(page, 'Manual request')).toBeVisible()
    await expect(page.getByRole('textbox', { name: new RegExp(`^${MILESTONE}, ${dayLabel(MANUAL_DAY)}`) })).toHaveCount(0)
    await page.goto(sheet(TYPED_DAY))
    await page.getByLabel(new RegExp(`^${MILESTONE}, ${dayLabel(TYPED_DAY)}`)).fill('1')
    await page.getByRole('textbox', { name: `Work note, ${MILESTONE}` }).fill('Reviewed the mapping rules for the import.')
    await page.getByRole('button', { name: 'Submit 1 change' }).click()
    await expect(page.getByRole('button', { name: /^Submit \d+ changes?$/ })).toHaveCount(0)
    await expect(inDay(page, 'Pending')).toBeVisible()

    // The manager: the bell, the tab, To review and week approval.
    await signOut(page)
    await signIn(page, 'manager.demo')
    await openBell(page)
    const alert = page.getByRole('menuitem', { name: `${person.first} logged 2h on ${MILESTONE} (${short}) without the timer: Forgot to start the timer` })
    await expect(alert).toBeVisible()
    await alert.click()
    await expect(page).toHaveURL(/\/timesheets\?tab=manual&user=/)
    const userId = new URL(page.url()).searchParams.get('user')
    const tab = page.getByRole('tab', { name: /^Manual hours \d+/ })
    await expect(tab).toBeVisible()
    expect(Number((await tab.innerText()).match(/\d+/)[0])).toBeGreaterThanOrEqual(1)

    await page.goto(`/timesheets?user=${userId}`)
    const card = page.getByRole('region').filter({ has: page.getByRole('link', { name: '2h more in Manual hours' }) })
    await expect(card).toBeVisible()
    await expect(card.getByText(dayLabel(MANUAL_DAY))).toHaveCount(0)
    await card.getByRole('button', { name: 'Approve week' }).click()
    await expect(page.getByText(/^Approved the week \(/)).toBeVisible()

    await page.goto(`/timesheets?tab=manual&user=${userId}`)
    await expect(requestRow(page, person.name)).toBeVisible()

    // Approve week never includes manual entries: the server answers 409 MANUAL_REVIEW_ONLY.
    const login = await request.post('/api/v1/auth/login', { data: { username: 'manager.demo', password: DEMO_PASSWORD } })
    const headers = { Authorization: `Bearer ${(await login.json()).access_token}` }
    const listed = await (await request.get('/api/v1/manual-hours', { headers })).json()
    const mine = listed.find((i) => i.user.name === person.name && i.entry.work_date === MANUAL_DAY)
    expect(mine, 'the request is listed for the manager').toBeTruthy()
    const refused = await request.post('/api/v1/approvals/approve-week', {
      headers, data: { entries: [{ id: mine.entry.id, expected_hours: mine.entry.hours }] },
    })
    expect(refused.status()).toBe(409)
    expect((await refused.json()).error.code).toBe('MANUAL_REVIEW_ONLY')
    await page.reload()
    await expect(requestRow(page, person.name)).toBeVisible()

    await page.getByRole('button', { name: `Approve 2h, ${person.name}, ${short}` }).click()
    await expect(page.getByText(`Approved 2h for ${person.name}`)).toBeVisible()

    // The employee sees the decision.
    await signOut(page)
    await signIn(page, person.username)
    await openBell(page)
    await expect(page.getByRole('menuitem', { name: `Morgan approved your 2h of manual hours on ${MILESTONE} (${short})` })).toBeVisible()
    await page.keyboard.press('Escape')
    await page.goto(sheet(MANUAL_DAY))
    await expect(inDay(page, 'Approved')).toBeVisible()
  })

  test('edit approved manual hours → request changes → fix and resubmit → approve', async ({ page }, testInfo) => {
    test.slow()
    const person = PERSON[testInfo.project.name]
    const short = shortDay(MANUAL_DAY)
    const label = dayLabel(MANUAL_DAY)
    const reason = 'Please split these hours between Mapping and Cutover.'

    // Editing approved hours sends them back to pending.
    await signIn(page, person.username)
    await page.goto(sheet(MANUAL_DAY))
    await page.getByRole('button', { name: `Edit manual hours, ${MILESTONE}, ${label}` }).click()
    const edit = page.getByRole('dialog', { name: 'Edit manual hours' })
    await edit.getByLabel('Hours').fill('2.5')
    await edit.getByRole('button', { name: 'Save changes' }).click()
    await expect(edit).toBeHidden()
    await expect(inDay(page, 'Pending')).toBeVisible()

    // The manager asks for changes: a reason is required.
    await signOut(page)
    await signIn(page, 'manager.demo')
    await page.goto('/timesheets?tab=manual')
    const row = requestRow(page, person.name)
    await expect(row).toContainText('Edited after a decision')
    await page.getByRole('button', { name: `Request changes, ${person.name}, ${short}` }).click()
    const ask = page.getByRole('dialog', { name: 'Request changes' })
    await ask.getByRole('button', { name: 'Request changes', exact: true }).click()
    await expect(ask.getByText('Tell the employee why')).toBeVisible()
    await ask.getByLabel('Reason').fill(reason)
    await ask.getByRole('button', { name: 'Request changes', exact: true }).click()
    await expect(page.getByText(`Sent back to ${person.name}`)).toBeVisible()

    // The employee fixes and resubmits.
    await signOut(page)
    await signIn(page, person.username)
    await openBell(page)
    await expect(page.getByRole('menuitem', { name: `Your 2.5h of manual hours on ${MILESTONE} (${short}) need changes: ${reason}` })).toBeVisible()
    await page.keyboard.press('Escape')
    await page.goto(sheet(MANUAL_DAY))
    await expect(inDay(page, 'Needs revision')).toBeVisible()
    await expect(page.getByText(`Reason: ${reason}`)).toBeVisible()
    await page.getByRole('button', { name: `Fix and resubmit, ${MILESTONE}, ${label}` }).click()
    const fix = page.getByRole('dialog', { name: 'Fix and resubmit' })
    await expect(fix.getByRole('alert').filter({ hasText: reason })).toBeVisible()
    await fix.getByLabel('Hours').fill('3')
    await fix.getByRole('button', { name: 'Resubmit' }).click()
    await expect(fix).toBeHidden()
    await expect(inDay(page, 'Pending')).toBeVisible()

    // The manager approves the resubmission.
    await signOut(page)
    await signIn(page, 'manager.demo')
    await openBell(page)
    await expect(page.getByRole('menuitem', { name: `${person.first} resubmitted 3h of manual hours on ${MILESTONE} (${short})` })).toBeVisible()
    await page.keyboard.press('Escape')
    await page.goto('/timesheets?tab=manual')
    await page.getByRole('button', { name: `Approve 3h, ${person.name}, ${short}` }).click()
    await expect(page.getByText(`Approved 3h for ${person.name}`)).toBeVisible()

    await signOut(page)
    await signIn(page, person.username)
    await page.goto(sheet(MANUAL_DAY))
    await expect(inDay(page, 'Approved')).toBeVisible()
  })
})
