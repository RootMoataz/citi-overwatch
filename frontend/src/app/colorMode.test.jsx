import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useTheme } from '@mui/material/styles'
import { Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { renderWithProviders, users } from '../test/render.jsx'
import { setPrefersDark } from '../test/setup.js'
import { COLOR_MODE_KEY } from './colorMode.js'
import Layout from './Layout.jsx'

function ModeProbe() {
  return <output data-testid="mode">{useTheme().palette.mode}</output>
}

function renderApp() {
  return renderWithProviders(
    <Routes>
      <Route element={<Layout user={users.manager} onLogout={() => {}} />}>
        <Route path="/" element={<ModeProbe />} />
      </Route>
    </Routes>,
  )
}

const openMenu = () => userEvent.click(screen.getByRole('button', { name: /account menu/i }))

describe('colour theme', () => {
  afterEach(() => vi.restoreAllMocks())

  test('defaults to System, which follows the operating system', async () => {
    setPrefersDark(true)
    renderApp()
    expect(screen.getByTestId('mode')).toHaveTextContent('dark')
    await openMenu()
    expect(await screen.findByRole('menuitemradio', { name: /system/i })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('menuitemradio', { name: /^dark/i })).toHaveAttribute('aria-checked', 'false')
  })

  test('System is light when the operating system is light', () => {
    renderApp()
    expect(screen.getByTestId('mode')).toHaveTextContent('light')
  })

  test('picking Dark in the account menu switches the theme and is remembered in this browser', async () => {
    renderApp()
    await openMenu()
    await userEvent.click(await screen.findByRole('menuitemradio', { name: /^dark/i }))
    expect(screen.getByTestId('mode')).toHaveTextContent('dark')
    expect(screen.getByRole('menuitemradio', { name: /^dark/i })).toHaveAttribute('aria-checked', 'true')
    expect(localStorage.getItem(COLOR_MODE_KEY)).toBe('dark')
    await userEvent.click(screen.getByRole('menuitemradio', { name: /^light/i }))
    expect(screen.getByTestId('mode')).toHaveTextContent('light')
    expect(localStorage.getItem(COLOR_MODE_KEY)).toBe('light')
  })

  test('a remembered choice wins over the operating system', () => {
    localStorage.setItem(COLOR_MODE_KEY, 'light')
    setPrefersDark(true)
    renderApp()
    expect(screen.getByTestId('mode')).toHaveTextContent('light')
  })

  test('works when the browser blocks storage (private mode)', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    renderApp()
    expect(screen.getByTestId('mode')).toHaveTextContent('light')
    await openMenu()
    await userEvent.click(await screen.findByRole('menuitemradio', { name: /^dark/i }))
    expect(screen.getByTestId('mode')).toHaveTextContent('dark')
  })
})
