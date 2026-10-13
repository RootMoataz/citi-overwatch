import { expect, test } from '@playwright/test'
import { dollars, openProject, signIn, signOut } from './helpers.js'

// The seed already gives Eli 45h this week, so each project uses a teammate on the same milestone with a clean week.
const PERSON = { desktop: { username: 'ben.okafor', name: 'Ben Okafor' }, mobile: { username: 'ana.ruiz', name: 'Ana Ruiz' } }

async function consumed(page) {
  await openProject(page, 'Apollo Data Migration', 'budget')
  const value = page.getByText('Consumed (approved hours)').locator('xpath=following-sibling::*[1]')
  await expect(value).toHaveText(/\$/)
  return dollars(await value.innerText())
}

test('employee logs 9h Mon–Fri → Friday shows the overtime label → manager gets one notification → opens the breakdown → approves → budget consumed rises', async ({ page }, testInfo) => {
  const person = PERSON[testInfo.project.name]

  await signIn(page, person.username)
  await page.goto('/timesheet')
  for (const day of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']) {
    await page.getByLabel(new RegExp(`^Schema Mapping, ${day}`)).fill('9')
  }
  await expect(page.getByText(/Over 40 hours this week/)).toBeVisible()
  await page.getByRole('button', { name: 'Save week' }).click()
  await expect(page.getByTestId('week-total')).toHaveText('45h / 40h')
  // Only the entry that crosses 40h (Friday: 36h → 45h) is overtime.
  const overtime = page.getByText(/^Pending \(Overtime requested from .+\)$/)
  await expect(overtime).toHaveCount(1)
  await expect(page.getByText('Pending approval')).toHaveCount(4)

  await signOut(page)
  await signIn(page, 'manager.demo')
  const before = await consumed(page)

  await page.getByRole('button', { name: /^Notifications, \d+ unread/ }).click()
  const alerts = page.getByRole('menuitem', { name: new RegExp(`${person.name} passed 40h`) })
  await expect(alerts).toHaveCount(1)
  await alerts.click()
  await expect(page).toHaveURL(/\/approvals\?user=/)

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
