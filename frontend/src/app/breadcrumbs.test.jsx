import { screen, within } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { describe, expect, test } from 'vitest'
import { renderWithProviders, users } from '../test/render.jsx'
import { setViewport } from '../test/setup.js'
import { useBreadcrumb } from './breadcrumbs.js'
import Layout from './Layout.jsx'

function NamedPage({ name, failed }) {
  useBreadcrumb(name, { failed })
  return <p>Page body</p>
}

function renderAt(user, route, name, failed) {
  return renderWithProviders(
    <Routes>
      <Route element={<Layout user={user} onLogout={() => {}} />}>
        <Route index element={<p>Home</p>} />
        <Route path="people" element={<p>People</p>} />
        <Route path="archive" element={<p>Archive</p>} />
        <Route path="profile" element={<p>Profile</p>} />
        <Route path="projects/:id" element={<NamedPage name={name} failed={failed} />} />
        <Route path="people/:id/profile" element={<NamedPage name={name} failed={failed} />} />
        <Route path="people/:id" element={<NamedPage name={name} failed={failed} />} />
        <Route path="*" element={<p>Not found</p>} />
      </Route>
    </Routes>,
    { route },
  )
}

const trail = () => within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getAllByRole('listitem').map((li) => li.textContent.replace(/^\//, ''))

describe('breadcrumbs', () => {
  test.each([
    ['employee home', users.employee, '/', ['Workspace', 'My week']],
    ['manager home', users.manager, '/', ['Workspace', 'Dashboard']],
    ['admin home', users.admin, '/', ['Workspace', 'Control centre']],
    ['admin People', users.admin, '/people', ['Administration', 'People']],
    ['executive Archive', users.executive, '/archive', ['Workspace', 'Archive']],
    ['profile', users.employee, '/profile', ['Workspace', 'My profile']],
    ['unknown route', users.employee, '/nowhere', ['Workspace', 'Page not found']],
  ])('%s', (_name, user, route, expected) => {
    renderAt(user, route)
    expect(trail()).toEqual(expected)
  })

  test('a project is Projects / name, with Projects linking back', () => {
    renderAt(users.manager, '/projects/p1', 'Apollo')
    expect(trail()).toEqual(['Projects', 'Apollo'])
    expect(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('link', { name: 'Projects' })).toHaveAttribute('href', '/projects')
  })

  test('before the name loads a skeleton shows, never "undefined"', () => {
    renderAt(users.manager, '/projects/p1', undefined)
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(nav).not.toHaveTextContent(/undefined/i)
    expect(nav).toHaveTextContent('Projects')
    expect(nav.querySelector('.MuiSkeleton-root')).not.toBeNull()
  })

  test('your own history as an employee is Workspace / My history', () => {
    renderAt(users.employee, `/people/${users.employee.id}/profile`, 'Eli Employee')
    expect(trail()).toEqual(['Workspace', 'My history'])
  })

  test('an admin viewing someone is Administration / People / name', () => {
    renderAt(users.admin, '/people/u-9/profile', 'Sam Smith')
    expect(trail()).toEqual(['Administration', 'People', 'Sam Smith'])
  })

  test('a manager viewing someone is Workspace / name', () => {
    renderAt(users.manager, '/people/u-9/profile', 'Sam Smith')
    expect(trail()).toEqual(['Workspace', 'Sam Smith'])
  })

  test('only the last crumb is the current page, and the root is plain text', () => {
    renderAt(users.admin, '/people/u-9', 'Sam Smith')
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' })
    const current = nav.querySelectorAll('[aria-current]')
    expect(current).toHaveLength(1)
    expect(current[0]).toHaveAttribute('aria-current', 'page')
    expect(current[0]).toHaveTextContent('Sam Smith')
    expect(within(nav).queryByRole('link', { name: 'Administration' })).toBeNull()
    expect(within(nav).getByRole('link', { name: 'People' })).toHaveAttribute('href', '/people')
  })

  test('on a phone a project page has a Projects back link and no full trail', () => {
    setViewport(400)
    renderAt(users.manager, '/projects/p1', 'Apollo')
    expect(screen.getByRole('link', { name: 'Projects' })).toHaveAttribute('href', '/projects')
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).toBeNull()
    expect(screen.queryByText('Apollo')).toBeNull()
  })

  test('when the page fails to load the last crumb says "Not found", not a skeleton', () => {
    renderAt(users.manager, '/projects/p1', undefined, true)
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(trail()).toEqual(['Projects', 'Not found'])
    expect(nav.querySelector('.MuiSkeleton-root')).toBeNull()
    expect(within(nav).getByText('Not found')).toHaveAttribute('aria-current', 'page')
  })

  test('the "/" separators are real aria-hidden elements, not generated content', () => {
    renderAt(users.admin, '/people/u-9', 'Sam Smith')
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' })
    const separators = nav.querySelectorAll('li > [aria-hidden="true"]')
    expect(separators).toHaveLength(2)
    separators.forEach((sep) => expect(sep).toHaveTextContent('/'))
  })
})
