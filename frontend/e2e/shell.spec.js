import { expect, test } from '@playwright/test'
import { openProject, signIn, signOut } from './helpers.js'

// Layout checks a unit test can't make (jsdom has no layout): the top bar's controls never overlap on a phone, the
// desktop crumbs give way to the controls beside them, and no page scrolls sideways at 375 px.

/** Runs in the page (it is self-contained). Each in-flow child of `container` as the stretch of x it draws over: its own box and everything drawn inside it,
 * text included (a logo box squeezed by flexbox while its wordmark kept drawing at full width was the bug, and so was
 * a crumb whose box shrank while its text ran on under the next one). What an ancestor clips (an ellipsis) doesn't
 * count; badges and visually hidden live regions sit outside the flow. */
function drawnChildren(container) {
  const placed = (el) => !['absolute', 'fixed'].includes(getComputedStyle(el).position)
  const clips = (el) => getComputedStyle(el).overflowX !== 'visible'
  // What is left of `rect` after every element from `from` up to the child that clips its content.
  const visible = (from, rect, child) => {
    let { left, right } = rect
    for (let a = from; a && a !== child.parentElement; a = a.parentElement) {
      if (clips(a)) {
        const r = a.getBoundingClientRect()
        left = Math.max(left, r.left)
        right = Math.min(right, r.right)
      }
    }
    return right > left ? { left, right } : null
  }
  return [...container.children].filter((child) => placed(child) && getComputedStyle(child).display !== 'none').map((child) => {
    const own = child.getBoundingClientRect()
    let { left, right } = own
    const take = (part) => { if (part) { left = Math.min(left, part.left); right = Math.max(right, part.right) } }
    for (const el of child.querySelectorAll('*')) {
      if (!placed(el) || el.closest('[class*="MuiBadge-badge"]')) continue
      const r = el.getBoundingClientRect()
      if (r.width && r.height) take(visible(el.parentElement, r, child))
    }
    const walker = document.createTreeWalker(child, NodeFilter.SHOW_TEXT)
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      if (!text.textContent.trim() || text.parentElement.closest('[class*="MuiBadge-badge"]')) continue
      const range = document.createRange()
      range.selectNodeContents(text)
      const r = range.getBoundingClientRect()
      if (r.width && r.height) take(visible(text.parentElement, r, child))
    }
    const name = child.getAttribute('aria-label') || child.textContent.trim() || child.tagName
    return { name, left, right, width: own.width }
  }).filter((c) => c.width > 0).sort((a, b) => a.left - b.left)
}

/** Fails (softly, naming the pair) for any of `items` drawn over the one before it or off [0, width]. */
function expectApart(items, width, label) {
  for (const c of items) {
    expect.soft(c.left, `${label}: ${c.name} starts on screen`).toBeGreaterThanOrEqual(-0.5)
    expect.soft(c.right, `${label}: ${c.name} ends on screen`).toBeLessThanOrEqual(width + 0.5)
  }
  items.slice(1).forEach((c, i) => {
    expect.soft(c.left, `${label}: ${c.name} overlaps ${items[i].name}`).toBeGreaterThanOrEqual(items[i].right - 0.5)
  })
}

async function expectTopBarFits(page, width, label) {
  // The shell settles (crumb names, the timer chip) before measuring.
  await expect(page.getByRole('banner')).toBeVisible()
  await page.waitForLoadState('networkidle')
  // The bar's toolbar is the banner's only child; Playwright runs drawnChildren in the page on it.
  expectApart(await page.getByRole('banner').locator(':scope > *').evaluate(drawnChildren), width, label)
}

const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth)

async function closeDemoWelcome(page) {
  const gotIt = page.getByRole('button', { name: 'Got it' })
  await gotIt.click()
  await expect(gotIt).toBeHidden()
}

// @phone checks run in the mobile project only and @desktop ones in the desktop project (playwright.config.js).
test.describe('phone top bar', { tag: '@phone' }, () => {
  for (const width of [375, 390]) {
    test(`${width} px: demo admin home, an employee's project page, and an employee with a running timer`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 })

      await signIn(page, 'demo.admin')
      await closeDemoWelcome(page)
      await expect(page.getByRole('button', { name: /^Demo session, signed out in/ })).toBeVisible()
      await expectTopBarFits(page, width, 'demo admin home')
      await signOut(page)

      await signIn(page, 'employee.demo')
      await openProject(page, 'Apollo Data Migration')
      await expect(page.getByRole('banner').getByRole('link', { name: 'Projects' })).toBeVisible()
      await expectTopBarFits(page, width, 'employee project page')

      // A running timer adds its chip to the bar.
      await page.goto('/')
      await page.getByRole('button', { name: /^Start timer on / }).first().click()
      const chip = page.getByRole('button', { name: /^Timer running on / })
      await expect(chip).toBeVisible()
      try {
        await expectTopBarFits(page, width, 'employee home with a timer')
        await openProject(page, 'Apollo Data Migration')
        await expect(chip).toBeVisible()
        await expectTopBarFits(page, width, 'employee project page with a timer')
      } finally {
        // Leave no clock running for the next journey (under 7.5 minutes it records nothing).
        await chip.click()
        const stop = page.getByRole('dialog')
        await stop.getByRole('button', { name: /^Stop/ }).click()
        await expect(chip).toBeHidden()
      }
    })
  }
})

test('desktop crumbs: a long project name ends in an ellipsis and never runs under the search field', { tag: '@desktop' }, async ({ page }) => {
  const long = 'Apollo Data Migration and Cross-Region Customer Ledger Consolidation for the Treasury Operations Programme 2026'
  // The project's name comes back long (names may be 120 characters); nothing is saved.
  await page.route(/\/api\/v1\/projects\/[^/?]+(\?.*)?$/, async (route) => {
    const response = await route.fetch()
    const json = await response.json()
    await route.fulfill({ response, json: { ...json, name: long } })
  })
  await page.setViewportSize({ width: 1440, height: 900 })
  await signIn(page, 'employee.demo')
  await openProject(page, 'Apollo Data Migration')
  const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' })
  await expect(crumbs.getByText(long)).toBeVisible()
  await page.waitForLoadState('networkidle')
  // Each crumb as drawn, text included: none runs under the next, and the last stops before the search field.
  const items = await crumbs.getByRole('list').evaluate(drawnChildren)
  const search = await page.getByRole('button', { name: /^Search \(/ }).boundingBox()
  expectApart(items, search.x, 'desktop crumbs')
  const last = crumbs.getByText(long)
  expect(await last.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true) // cut short with an ellipsis
  await expect(last).toHaveCSS('text-overflow', 'ellipsis')
  await expectTopBarFits(page, 1440, 'desktop project page')
})

// Names can be 120 characters, and a surname can be one long word. This stretches every name the API returns (projects,
// milestones, people, departments, subjects) without saving anything.
const LONG_WORD = 'Wolfeschlegelsteinhausenbergerdorff'
function stretchNames(value) {
  if (Array.isArray(value)) return value.map(stretchNames)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, v]) => {
    if (typeof v === 'string' && (key === 'name' || key === 'subject' || key.endsWith('_name')) && key !== 'first_name') {
      return [key, `${v} and Cross-Region Customer Ledger Consolidation ${LONG_WORD}`]
    }
    return [key, stretchNames(v)]
  }))
}
async function useLongNames(page) {
  await page.route(/\/api\/v1\//, async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    const response = await route.fetch()
    if (!(response.headers()['content-type'] ?? '').includes('application/json')) return route.fulfill({ response })
    return route.fulfill({ response, json: stretchNames(await response.json()) })
  })
}

test.describe('no sideways page scroll at 375 px', { tag: '@phone' }, () => {
  for (const names of ['seeded', 'long']) {
    for (const username of ['employee.demo', 'manager.demo', 'executive.demo', 'admin.demo']) {
      test(`${username}, ${names} names: every page in the navigation, a project and My profile`, async ({ page }) => {
        test.slow() // a dozen pages for some roles
        await page.setViewportSize({ width: 375, height: 800 })
        if (names === 'long') await useLongNames(page)
        await signIn(page, username)
        await page.getByRole('button', { name: 'Open navigation' }).click()
        const nav = page.getByRole('navigation', { name: 'Main navigation' })
        const paths = await nav.getByRole('link').evaluateAll((links) => links.map((a) => new URL(a.href).pathname))
        await page.keyboard.press('Escape')
        expect(paths.length).toBeGreaterThan(3)
        const wide = []
        const check = async (where) => {
          await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
          await page.waitForLoadState('networkidle')
          const scroll = await sideways(page)
          if (scroll > 375) wide.push(`${where} (${scroll}px)`)
        }
        for (const path of paths) {
          await page.goto(path)
          await check(path)
        }
        await page.goto('/projects')
        await page.getByText(/^Apollo Data Migration/).first().click()
        await expect(page).toHaveURL(/\/projects\/[^/?]+/)
        await check('a project page')
        await page.goto('/profile')
        await check('/profile')
        expect(wide, `pages wider than 375 px for ${username} with ${names} names`).toEqual([])
      })
    }
  }
})
