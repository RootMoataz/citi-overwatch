import { expect } from '@playwright/test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const DEMO_PASSWORD = 'Demo123!'
export const OUTBOX = join(import.meta.dirname, '..', '..', 'backend', 'v1', '.outbox')

export async function signIn(page, username, password = DEMO_PASSWORD) {
  await page.goto('/login')
  await page.getByLabel(/^Username/).fill(username)
  await page.getByLabel(/^Password/).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

/** Drop the refresh cookie and reload, which also clears the in-memory access token. */
export async function signOut(page) {
  await page.context().clearCookies()
  await page.goto('/login')
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
}

/** The newest local-outbox email sent to this address. */
export function latestEmailTo(address) {
  const files = readdirSync(OUTBOX).filter((f) => f.endsWith(`-${address}.txt`)).sort()
  if (!files.length) throw new Error(`No email to ${address} in ${OUTBOX}`)
  return readFileSync(join(OUTBOX, files.at(-1)), 'utf-8')
}

/** Pick an option in an MUI select by its label. */
export async function choose(page, label, option) {
  await page.getByRole('combobox', { name: label }).click()
  await page.getByRole('option', { name: option }).click()
}

export async function openProject(page, name, tab) {
  await page.goto('/projects')
  await page.getByText(name, { exact: true }).first().click()
  await expect(page).toHaveURL(/\/projects\/[^/?]+/)
  if (tab) await page.goto(`${new URL(page.url()).pathname}?tab=${tab}`)
}

export const dollars = (text) => Number(text.replace(/[^0-9.-]/g, ''))
