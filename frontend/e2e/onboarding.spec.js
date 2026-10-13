import { expect, test } from '@playwright/test'
import { choose, latestEmailTo, signIn, signOut } from './helpers.js'

test('admin creates user → user logs in with emailed temp password → forced change → dashboard', async ({ page }, testInfo) => {
  const last = testInfo.project.name === 'mobile' ? 'Mobile' : 'Desktop'
  const email = `quinn.${last.toLowerCase()}@acme.example`

  await signIn(page, 'admin.demo')
  await page.goto('/people')
  await page.getByRole('button', { name: 'New account' }).click()
  const wizard = page.getByRole('dialog', { name: 'New account' })

  await wizard.getByLabel(/^First name/).fill('Quinn')
  await wizard.getByLabel(/^Last name/).fill(last)
  await wizard.getByRole('button', { name: 'Next' }).click()

  await wizard.getByLabel(/^Email/).fill(email)
  await choose(page, /^Role/, 'Employee')
  await choose(page, /^Reports to/, 'Morgan Manager')
  await wizard.getByRole('button', { name: 'Next' }).click()

  // The username starts from the first free suggestion and is checked live.
  const username = wizard.getByLabel('Username')
  await expect(username).toHaveValue(new RegExp(last.toLowerCase()))
  await expect(wizard.getByLabel('Available')).toBeVisible()
  const chosen = await username.inputValue()
  await wizard.getByRole('button', { name: 'Next' }).click()

  await wizard.getByRole('button', { name: 'Generate password' }).click()
  await wizard.getByRole('button', { name: 'Next' }).click()
  await expect(wizard.getByRole('table', { name: 'Review the new account' })).toContainText(chosen)
  await wizard.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/people\/[0-9a-f-]+$/)

  const mail = latestEmailTo(email)
  expect(mail).toContain(`Username: ${chosen}`)
  const temp = mail.match(/Temporary password: (\S+)/)[1]

  await signOut(page)
  await signIn(page, chosen, temp)
  const change = page.getByRole('dialog', { name: /choose a new password/i })
  await change.getByLabel(/^Temporary password/).fill(temp)
  await change.getByLabel(/^New password/).fill('Quinn#2026')
  await change.getByLabel(/^Confirm new password/).fill('Quinn#2026')
  await change.getByRole('button', { name: 'Save password' }).click()

  await expect(change).toBeHidden()
  await expect(page.getByRole('heading', { name: /status of each active project/i, level: 2 })).toBeVisible()
})
