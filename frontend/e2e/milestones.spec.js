import { expect, test } from '@playwright/test'
import { openProject, signIn, signOut } from './helpers.js'

const iso = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)

test('manager adds a dependent milestone; assignee moves it to ready for review; manager completes', async ({ page }, testInfo) => {
  const name = `QA sign-off (${testInfo.project.name})`
  const card = () => page.locator('[data-milestone]').filter({ has: page.getByRole('heading', { name, exact: true }) })

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
  await expect(card()).toContainText('after Discovery')
  await expect(card()).toContainText('Eli Employee')

  await signOut(page)
  await signIn(page, 'employee.demo')
  await openProject(page, 'Apollo Data Migration', 'milestones')
  await expect(card()).toContainText('Assigned to you')
  await card().getByRole('button', { name: 'Start' }).click()
  await card().getByRole('button', { name: 'Ready for review' }).click()
  await expect(card()).toContainText(/ready for review/i)
  await expect(card().getByRole('button', { name: 'Complete' })).toHaveCount(0) // only the PM or an admin completes

  await signOut(page)
  await signIn(page, 'manager.demo')
  await openProject(page, 'Apollo Data Migration', 'milestones')
  await card().getByRole('button', { name: 'Complete' }).click()
  await expect(card()).toContainText(/completed/i)
  await expect(card().getByRole('button', { name: 'Reopen' })).toBeVisible()
})
