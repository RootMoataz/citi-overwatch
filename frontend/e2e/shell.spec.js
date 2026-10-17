import { expect, test } from '@playwright/test'
import { openProject, signIn, signOut } from './helpers.js'

// Layout checks a unit test can't make (jsdom has no layout): the top bar's controls never overlap on a phone (320 to
// 390 px) and the phone back link stays a 24 px target; the desktop crumbs give way to the controls beside them (at
// 1440 px with a long name, and between md and lg for the demo admin); no page scrolls sideways at 375 px, nor the
// Dashboard, Control centre and My history between md and lg; on a phone the Week grid's fixed Milestone column never
// covers the day cells, even with very long names.

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

// The Monday before this week's, by New York's calendar (the app's "today" is New York's).
function lastMonday() {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()).split('-').map(Number)
  const day = new Date(Date.UTC(y, m - 1, d))
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7) - 7)
  return day.toISOString().slice(0, 10)
}

async function closeDemoWelcome(page) {
  const gotIt = page.getByRole('button', { name: 'Got it' })
  await gotIt.click()
  await expect(gotIt).toBeHidden()
}

/** The phone bar's back link stays a real target, at least 24 × 24 px (WCAG 2.5.8), however full the bar is. */
async function expectBackTarget(page, label) {
  const back = page.getByRole('banner').getByRole('link', { name: /Projects/ })
  await expect(back).toHaveCount(1)
  const box = await back.evaluate((el) => el.getBoundingClientRect().toJSON())
  expect.soft(box.width, `${label}: the back link is at least 24 px wide`).toBeGreaterThanOrEqual(24)
  expect.soft(box.height, `${label}: the back link is at least 24 px tall`).toBeGreaterThanOrEqual(24)
}

// @phone checks run in the mobile project only and @desktop ones in the desktop project (playwright.config.js).
test.describe('phone top bar', { tag: '@phone' }, () => {
  for (const width of [320, 375, 390]) {
    test(`${width} px: demo admin home and project page, an employee's project page, and an employee with a running timer`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 })

      await signIn(page, 'demo.admin')
      await closeDemoWelcome(page)
      await expect(page.getByRole('button', { name: /left in the demo session, signed out in/ })).toBeVisible()
      await expectTopBarFits(page, width, 'demo admin home')
      // Every action stays reachable: under 375 px Puppy moves from the bar into the account menu.
      if (width < 375) {
        await expect(page.getByRole('banner').getByRole('button', { name: 'Puppy assistant' })).toHaveCount(0)
        await page.getByRole('banner').getByRole('button', { name: 'Account menu' }).click()
        await page.getByRole('menuitem', { name: 'Puppy assistant' }).click()
        await expect(page.getByRole('dialog', { name: 'Puppy assistant' })).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(page.getByRole('dialog', { name: 'Puppy assistant' })).toBeHidden()
      } else {
        await expect(page.getByRole('banner').getByRole('button', { name: 'Puppy assistant' })).toBeVisible()
      }
      await openProject(page, 'Apollo Data Migration')
      await expectBackTarget(page, 'demo admin project page')
      await expectTopBarFits(page, width, 'demo admin project page')
      await signOut(page)

      await signIn(page, 'employee.demo')
      await openProject(page, 'Apollo Data Migration')
      await expectBackTarget(page, 'employee project page')
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
        await expectBackTarget(page, 'employee project page with a timer')
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

// Between md (900 px) and lg (1200 px) the sidebar is open and the bar is short of room, most of all for the demo admin
// (its pill). The crumbs never run under the search field, and the current page keeps a few letters.
test.describe('desktop top bar between md and lg', { tag: '@desktop' }, () => {
  for (const width of [900, 960, 1024]) {
    test(`${width} px: the demo admin's crumbs on home, a project page and a person page`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 })
      await signIn(page, 'demo.admin')
      await closeDemoWelcome(page)
      const check = async (where) => {
        const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' })
        const current = crumbs.locator('[aria-current="page"]')
        await expect(current).not.toHaveAttribute('aria-busy', 'true') // the page has named its crumb
        await page.waitForLoadState('networkidle')
        const items = await crumbs.getByRole('list').evaluate(drawnChildren)
        const search = await page.getByRole('button', { name: /^Search \(/ }).boundingBox()
        expectApart(items, search.x, `${where} crumbs`)
        const shown = await current.evaluate((el) => el.getBoundingClientRect().width)
        expect.soft(shown, `${where}: the current page's crumb keeps a few letters`).toBeGreaterThanOrEqual(40)
        await expectTopBarFits(page, width, where)
      }
      await check('home')
      await openProject(page, 'Apollo Data Migration')
      await check('project page')
      await page.goto('/people')
      await page.locator('main a[href^="/people/"]').first().click()
      await expect(page).toHaveURL(/\/people\/[^/?]+/)
      await check('person page')
    })
  }
})

test.describe('no sideways page scroll between md and lg', { tag: '@desktop' }, () => {
  // My history at 1440 px fits its six columns; narrower, the table scrolls inside its card (with a fade at the edge),
  // never the page. The sidebar open or collapsed.
  test('employee.demo: My history at 900, 960, 1024 and 1440 px, sidebar open and collapsed', async ({ page }) => {
    await signIn(page, 'employee.demo')
    const history = await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'My history' })
      .getAttribute('href')
    const wide = []
    for (const collapsed of [false, true]) {
      await page.evaluate((c) => localStorage.setItem('overwatch.sidebarCollapsed', String(c)), collapsed)
      for (const width of [900, 960, 1024, 1440]) {
        await page.setViewportSize({ width, height: 800 })
        await page.goto(history)
        const card = page.getByRole('region', { name: 'Work history' })
        await expect(card.getByRole('table', { name: 'Milestones' })).toBeVisible()
        await page.waitForLoadState('networkidle')
        const scroll = await sideways(page)
        if (scroll > width) wide.push(`${width} px${collapsed ? ', collapsed' : ''} (${scroll}px)`)
        // The table ends inside its card, or scrolls inside it with the fade saying there is more.
        const fit = await card.evaluate((section) => {
          const box = section.querySelector('.MuiTableContainer-root')
          return { inside: box.getBoundingClientRect().right <= section.getBoundingClientRect().right + 0.5,
            overflows: box.scrollWidth - box.clientWidth > 1, fade: Boolean(section.querySelector('[data-scroll-fade="right"]')) }
        })
        expect.soft(fit.inside, `${width} px: the table's box stays inside its card`).toBe(true)
        expect.soft(fit.fade, `${width} px: a fade shows exactly when the table is wider than its card`).toBe(fit.overflows)
        if (width === 1440) expect.soft(fit.overflows, '1440 px: the six columns fit').toBe(false)
      }
    }
    expect(wide, 'My history wider than the window').toEqual([])
  })

  for (const [username, home] of [['manager.demo', 'Dashboard'], ['demo.admin', 'Control centre']]) {
    test(`${username}: ${home} at 900, 960 and 1024 px`, async ({ page }) => {
      await signIn(page, username)
      if (username === 'demo.admin') await closeDemoWelcome(page)
      const wide = []
      for (const width of [900, 960, 1024]) {
        await page.setViewportSize({ width, height: 800 })
        await page.goto('/')
        // The risk tiles (the widest row when this was found) have drawn.
        await expect(page.getByRole('list', { name: 'At-risk projects by reason' })).toBeVisible()
        await page.waitForLoadState('networkidle')
        const scroll = await sideways(page)
        if (scroll > width) wide.push(`${width} px (${scroll}px)`)
      }
      expect(wide, `${home} wider than the window`).toEqual([])
    })
  }
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
        // The employee screens' other states: My week's previous week, My timesheet's three views and its Entry details sheet,
        // and My history's Projects tab. In the Week view the grid scrolls inside its card, not the page, and its Milestone column stays put.
        if (username === 'employee.demo') {
          await page.goto(`/?week=${lastMonday()}`)
          await expect(page.getByRole('group', { name: "Week shown in This week's hours" })).toBeVisible()
          await check('My week, previous week')
        }
        if (paths.includes('/timesheet')) {
          await page.goto('/timesheet')
          await page.getByRole('button', { name: 'Day', exact: true }).click()
          await check('My timesheet, Day view')
          await page.getByRole('button', { name: 'Week', exact: true }).click()
          const grid = page.getByRole('table', { name: /^Timesheet for the week of/ })
          await expect(grid).toBeVisible()
          await check('My timesheet, Week view')
          const card = await grid.evaluateHandle((el) => el.closest('.MuiTableContainer-root'))
          const milestone = grid.getByRole('columnheader', { name: 'Milestone' })
          const [before, firstDay] = [await milestone.boundingBox(), await grid.getByRole('columnheader').nth(1).boundingBox()]
          expect(await card.evaluate((el) => el.scrollWidth > el.clientWidth), 'the grid scrolls inside its card').toBe(true)
          expect(await sideways(page), 'the page itself does not scroll sideways').toBeLessThanOrEqual(375)
          await card.evaluate((el) => { el.scrollLeft = 200 })
          await expect.poll(() => card.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
          expect((await grid.getByRole('columnheader').nth(1).boundingBox()).x, 'the day columns moved').toBeLessThan(firstDay.x)
          expect((await milestone.boundingBox()).x, 'the Milestone column stayed in place').toBeCloseTo(before.x, 0)
          await card.evaluate((el) => { el.scrollLeft = 0 })
          // The fixed Milestone column is capped (its name wraps), so the first day cell is never under it, long names
          // included: the point at the middle of that cell is the cell itself.
          const covered = await grid.evaluate((table) => {
            const row = [...table.querySelectorAll('tbody tr')].find((tr) => tr.querySelector('th') && tr.querySelectorAll('td').length > 1)
            const cell = row.querySelector('td')
            cell.scrollIntoView({ block: 'center', inline: 'nearest' })   // elementFromPoint only sees what's on screen
            const r = cell.getBoundingClientRect()
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 24))
            return cell.contains(hit) ? null : `${hit?.tagName ?? 'nothing'} ${hit?.textContent?.slice(0, 40) ?? ''}`
          })
          expect.soft(covered, `${names} names: the first day cell is not covered by the Milestone column`).toBeNull()
          const entry = page.locator('[data-entry]').first()
          // Eli always has saved hours this week (the seed logs his weekdays), so the check never skips for him.
          if (username === 'employee.demo') await expect(entry, 'employee.demo has a saved entry this week').toBeVisible()
          if (await entry.count()) {
            // A real tap: it fails if anything (the fixed column) covers the status line.
            await entry.tap()
            await expect(page.getByRole('dialog', { name: 'Entry details' })).toBeVisible()
            if ((await sideways(page)) > 375) wide.push(`Entry details open (${await sideways(page)}px)`)
            await page.keyboard.press('Escape')
            await expect(page.getByRole('dialog', { name: 'Entry details' })).toBeHidden()
          }
          await page.getByRole('button', { name: 'Month', exact: true }).click()
          await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible()
          await check('My timesheet, Month view')
          await page.getByRole('button', { name: 'Day', exact: true }).click() // leave the view as found
        }
        const history = paths.find((path) => /^\/people\/[^/]+\/profile$/.test(path))
        if (history) {
          await page.goto(`${history}?tab=projects`)
          await expect(page.getByRole('tab', { name: /^Projects/ })).toHaveAttribute('aria-selected', 'true')
          await check('My history, Projects tab')
        }
        // Manual hours: the managers' tab (stacked cards on a phone) and the employee's open "Log hours manually" dialog.
        if (username === 'manager.demo') {
          await page.goto('/timesheets?tab=manual')
          await expect(page.getByRole('tab', { name: /^Manual hours/ })).toHaveAttribute('aria-selected', 'true')
          await check('Timesheets, Manual hours tab')
        }
        if (username === 'employee.demo') {
          await page.goto('/')
          await page.getByRole('button', { name: /^Log hours manually on / }).first().click()
          const dialog = page.getByRole('dialog', { name: 'Log hours manually' })
          await expect(dialog).toBeVisible()
          await page.waitForLoadState('networkidle')
          // The dialog hides the page behind it from the tree, so measure the page directly.
          const scroll = await sideways(page)
          if (scroll > 375) wide.push(`My week, Log hours manually open (${scroll}px)`)
          const box = await dialog.boundingBox()
          expect.soft(box.x, 'the dialog starts on screen').toBeGreaterThanOrEqual(0)
          expect.soft(box.x + box.width, 'the dialog ends on screen').toBeLessThanOrEqual(375)
          await page.keyboard.press('Escape')
          await expect(dialog).toBeHidden()
        }
        await page.goto('/projects')
        await page.getByText(/^Apollo Data Migration/).first().click()
        await expect(page).toHaveURL(/\/projects\/[^/?]+/)
        await check('a project page')
        // Every project tab, then an open milestone panel (a full-screen sheet on a phone).
        const project = new URL(page.url()).pathname
        for (const tab of ['overview', 'milestones', 'team', 'budget', 'hours']) {
          await page.goto(`${project}?tab=${tab}`)
          await check(`the project's ${tab} tab`)
        }
        await page.goto(`${project}?tab=milestones`)
        const first = page.locator('[data-milestone-card], tbody tr').first()
        await expect(first).toBeVisible()
        await first.click()
        await expect(page).toHaveURL(/milestone=/)
        await check('an open milestone panel')
        await page.goto('/profile')
        await check('/profile')
        expect(wide, `pages wider than 375 px for ${username} with ${names} names`).toEqual([])
      })
    }
  }
})

// The design audit's fit checks at 1440 px with the sidebar open: every Milestones column (More included) fits its card,
// and beside an open Entry details panel (380 px) the Week grid shows all seven days and Counted.
test.describe('tables fit their cards at 1440 px, sidebar open', { tag: '@desktop' }, () => {
  const fits = (locator) => locator.evaluate((table) => {
    const box = table.closest('.MuiTableContainer-root')
    return box.scrollWidth - box.clientWidth
  })

  test('manager.demo: the Milestones list, every column inside the card', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signIn(page, 'manager.demo')
    await openProject(page, 'Apollo Data Migration', 'milestones')
    const table = page.getByRole('table', { name: 'Milestones' })
    await expect(table.getByRole('columnheader', { name: 'More' })).toBeVisible()
    await page.waitForLoadState('networkidle')
    expect(await fits(table), 'the list is no wider than its card').toBeLessThanOrEqual(1)
  })

  test('employee.demo: the Week grid beside Entry details keeps all seven days and Counted in view', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signIn(page, 'employee.demo')
    await page.evaluate(() => localStorage.setItem('overwatch.timesheet.view', 'week'))
    await page.goto('/timesheet')
    await page.getByRole('button', { name: /details for/ }).first().click()
    await expect(page.getByRole('complementary', { name: 'Entry details' })).toBeVisible()
    const grid = page.getByRole('table', { name: /^Timesheet for the week of/ })
    await expect(grid.getByRole('columnheader', { name: 'Counted' })).toBeVisible()
    expect(await fits(grid), 'the grid is no wider than its card').toBeLessThanOrEqual(1)
  })
})

// The audit's phone checks on a project's Budget and Hours tabs: the pending banner keeps its message beside the clock
// (the link drops under it, never squeezing the words into a narrow column), and its link and the small buttons are 44 px.
test.describe('pending banners and touch targets at 375 px', { tag: '@phone' }, () => {
  test('manager.demo: Budget and Hours', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await signIn(page, 'manager.demo')
    await openProject(page, 'Apollo Data Migration', 'budget')
    const height = (locator) => locator.evaluate((el) => el.getBoundingClientRect().height)
    for (const [tab, link] of [['budget', 'Review pending hours →'], ['hours', "Review this week's entries →"]]) {
      await page.goto(`${new URL(page.url()).pathname}?tab=${tab}`)
      const banner = page.getByRole('alert').filter({ hasText: 'awaiting approval' })
      await expect(banner).toBeVisible()
      const message = await banner.locator('.MuiAlert-message').evaluate((el) => el.getBoundingClientRect().width)
      expect.soft(message, `${tab}: the message has the banner's width beside its icon`).toBeGreaterThan(220)
      expect.soft(await height(banner.getByRole('link', { name: link })), `${tab}: the link is a 44 px target`).toBeGreaterThanOrEqual(44)
    }
    await page.goto(`${new URL(page.url()).pathname}?tab=budget`)
    for (const name of ['Print / PDF', /Export CSV/]) {
      expect.soft(await height(page.getByRole('button', { name }).first()), `${name}: a 44 px target`).toBeGreaterThanOrEqual(44)
    }
  })
})
