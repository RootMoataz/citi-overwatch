import { expect, test } from '@playwright/test'
import { dollars, openProject, signIn, signOut } from './helpers.js'

// The seed already gives Eli 45h this week, so each project uses a teammate on the same milestone who is under 40h.
// Their week may already hold some seeded hours (Ben's Monday, Ana's days so far); the journey overwrites each day to 9h.
const PERSON = { desktop: { username: 'ben.okafor', name: 'Ben Okafor' }, mobile: { username: 'ana.ruiz', name: 'Ana Ruiz' } }

// Stat tiles count up from 0; reduced motion makes them show the final amount straight away.
test.use({ contextOptions: { reducedMotion: 'reduce' } })

async function consumed(page) {
  await openProject(page, 'Apollo Data Migration', 'budget')
  const value = page.getByRole('group', { name: 'Budget figures' }).getByText('Approved spend', { exact: true }).locator('xpath=following-sibling::*[1]')
  await expect(value).toHaveText(/\$/)
  return dollars(await value.innerText())
}

test('employee logs 9h Mon–Fri → Friday shows Overtime → manager gets one notification → opens the breakdown → approves → budget consumed rises', async ({ page }, testInfo) => {
  test.slow() // two sign-ins, five days of hours and notes, and two budget reads
  const person = PERSON[testInfo.project.name]

  await signIn(page, person.username)
  await page.goto('/timesheet')
  // The Day view is the default: one day at a time, picked from the week strip ("Mon 12 Oct, 0h"), with one Submit for the whole week.
  for (const day of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']) {
    await page.getByRole('button', { name: new RegExp(`^${day} \\d`) }).click()
    await page.getByLabel(new RegExp(`^Schema Mapping, ${day}`)).fill('9')
    // Proof of work: new hours need a work note (or a progress update that day) before the week saves.
    // The seed may already hold hours (with or without a note) on earlier days of this week; fill replaces the note.
    await page.getByRole('textbox', { name: 'Work note, Schema Mapping' }).fill(`Mapped source tables to the new schema (${day}).`)
  }
  await expect(page.getByRole('alert').filter({ hasText: /This week is 45h — 5h over 40h/ })).toBeVisible()
  // Every day was typed and nothing is sent yet, so all 45h count as pending and none as approved.
  const totals = page.getByRole('group', { name: 'Week totals' })
  await expect(totals).toContainText('45h counted of 40h')
  await expect(totals.getByRole('listitem').filter({ hasText: 'Pending' })).toContainText('45h')
  await page.getByRole('button', { name: /^Submit \d+ changes?$/ }).click()
  await expect(page.getByTestId('week-total')).toHaveText('45h counted of 40h')
  // Only the entry that crosses 40h (Friday: 36h → 45h) is overtime. The Day view shows one day's status at a time (Friday is open).
  await expect(page.getByText('Overtime', { exact: true })).toHaveCount(1)
  for (const day of ['Mon', 'Tue', 'Wed', 'Thu']) {
    await page.getByRole('button', { name: new RegExp(`^${day} \\d`) }).click()
    await expect(page.getByText('Overtime', { exact: true })).toHaveCount(0)
  }

  // The Month view shows the same hours (Friday is the overtime day). Picking a day selects it and its panel (beside the grid, or under it
  // on a phone) lists the hours; "Edit in Day view" there opens the Day view on that day.
  const friday = (await page.getByRole('button', { name: /^Fri \d/ }).first().getAttribute('aria-label')).match(/Fri \d+ \w+/)[0]
  await page.getByRole('button', { name: 'Month', exact: true }).click()
  await page.getByRole('button', { name: new RegExp(`^${friday}, .*Schema Mapping 9 hours pending`) }).click()
  const panel = page.getByRole('region', { name: /^Friday, \w+ \d+, \d{4}$/ })
  await expect(panel).toContainText('9h pending')
  await expect(panel.getByRole('heading', { name: 'Schema Mapping' })).toBeVisible()
  await panel.getByRole('button', { name: /^Edit in Day view/ }).first().click()
  await expect(page.getByRole('button', { name: 'Day', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByLabel(/^Schema Mapping, Fri/)).toHaveValue('9')

  await signOut(page)
  await signIn(page, 'manager.demo')
  const before = await consumed(page)

  await page.getByRole('button', { name: /^Notifications, \d+ unread/ }).click()
  const alerts = page.getByRole('menuitem', { name: new RegExp(`${person.name} passed 40h`) })
  await expect(alerts).toHaveCount(1)
  await alerts.click()
  // Approvals now live on the Timesheets page ("To review" tab), filtered to this person.
  await expect(page).toHaveURL(/\/timesheets\?user=/)

  const row = page.locator('.MuiBox-root', { has: page.getByText(/Overtime requested from/) })
    .filter({ has: page.getByRole('button', { name: 'Approve' }) }).last()
  await expect(row).toContainText(person.name)
  await row.getByRole('button', { name: 'Budget impact' }).click()
  const breakdown = row.getByRole('table', { name: 'Budget impact of approving' })
  await expect(breakdown).toContainText('This request')
  await expect(breakdown).toContainText('Projected total')
  await row.getByRole('button', { name: 'Approve' }).click()
  await expect(page.getByText(/Overtime requested from/)).toHaveCount(0)

  expect(await consumed(page)).toBeGreaterThan(before)
})
