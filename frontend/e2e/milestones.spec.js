import { expect, test } from '@playwright/test'
import { openProject, signIn, signOut } from './helpers.js'

// A milestone's row (a table row on a desktop, a card on a phone), found by its name.
const rowOf = (page, name) => page.locator('tr, [data-milestone-card]').filter({ hasText: name }).first()
// The row's name opens the panel; on a phone the whole card is the tap area.
const openRow = async (page, name) => {
  const row = rowOf(page, name)
  const button = row.getByRole('button', { name, exact: true })
  if (await button.count()) await button.click()
  else await row.click()
  await expect(page).toHaveURL(/milestone=/)
}

const iso = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)

test('manager adds a dependent milestone; assignee moves it to ready for review in the panel; manager completes from the row', async ({ page }, testInfo) => {
  const name = `QA sign-off (${testInfo.project.name})`

  await signIn(page, 'manager.demo')
  await openProject(page, 'Apollo Data Migration', 'milestones')
  await page.getByRole('button', { name: 'Add milestone' }).click()
  const dialog = page.getByRole('dialog', { name: 'New milestone' })
  await dialog.getByLabel(/^Name/).fill(name)
  await dialog.getByLabel(/^Start date/).fill(iso(0))
  await dialog.getByLabel(/^End date/).fill(iso(14))
  await page.getByRole('combobox', { name: /^Depends on/ }).click()
  await page.getByRole('option', { name: /Discovery/ }).click()
  await page.keyboard.press('Escape')
  await page.getByRole('combobox', { name: /^Assigned to/ }).click()
  await page.getByRole('option', { name: /Eli Employee/ }).click()
  await page.keyboard.press('Escape')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()
  await expect(rowOf(page, name)).toContainText('Dependency: after Discovery')
  await expect(rowOf(page, name)).toContainText('Eli')

  await signOut(page)
  await signIn(page, 'employee.demo')
  // My week: Your focus, and the Completed group collapses (its rows go), stays collapsed after a reload, and expands again.
  await expect(page.getByRole('region', { name: 'Your focus' })).toBeVisible()
  const completed = page.getByRole('button', { name: /^Completed, \d+ milestones?$/ })
  // The group's body is the element the button controls (its id changes on each load).
  const bodyOf = async () => page.locator(`[id="${await completed.getAttribute('aria-controls')}"]`)
  let body = await bodyOf()
  await expect(completed).toHaveAttribute('aria-expanded', 'true')
  await expect(body.getByRole('heading', { level: 3 }).first()).toBeVisible()
  await completed.click()
  await expect(completed).toHaveAttribute('aria-expanded', 'false')
  await expect(body.getByRole('heading', { level: 3 })).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('region', { name: 'Your focus' })).toBeVisible()
  await expect(completed).toHaveAttribute('aria-expanded', 'false')
  body = await bodyOf()
  await completed.click()
  await expect(completed).toHaveAttribute('aria-expanded', 'true')
  await expect(body.getByRole('heading', { level: 3 }).first()).toBeVisible()

  await openProject(page, 'Apollo Data Migration', 'milestones')
  await expect(rowOf(page, name)).toContainText('You')
  await openRow(page, name)
  const details = page.getByRole('tabpanel')
  await details.getByRole('button', { name: 'Start', exact: true }).click()
  await details.getByRole('button', { name: 'Ready for review', exact: true }).click()
  await expect(details.getByRole('button', { name: 'Ready for review', exact: true })).toHaveCount(0)
  await expect(details.getByRole('button', { name: 'Complete' })).toHaveCount(0) // only the PM or an admin completes
  await expect(page.getByText(/ready for review/i).first()).toBeVisible()

  await signOut(page)
  await signIn(page, 'manager.demo')
  await openProject(page, 'Apollo Data Migration', 'milestones')
  await page.getByRole('button', { name: `More actions for ${name}` }).click()
  await page.getByRole('menuitem', { name: 'Complete' }).click()
  await expect(rowOf(page, name)).toContainText(/completed/i)
})
