import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from '@mui/material'
import { describe, expect, test } from 'vitest'
import Section from '../features/dashboard/Section.jsx'
import { renderWithProviders } from '../test/render.jsx'
import { setPrefersDark } from '../test/setup.js'

const bg = (el) => getComputedStyle(el).backgroundColor
const clear = (c) => c === '' || c === 'transparent' || /rgba\(0,\s*0,\s*0,\s*0\)|var\(--variant-/.test(c)

describe.each([['light', false], ['dark', true]])('tonal buttons (%s)', (_name, dark) => {
  test('a text button always has a tinted background', () => {
    setPrefersDark(dark)
    renderWithProviders(<><Button>Cancel</Button><Button disabled>Off</Button><Button variant="outlined">Out</Button></>)
    expect(clear(bg(screen.getByRole('button', { name: 'Cancel' })))).toBe(false)
    expect(clear(bg(screen.getByRole('button', { name: 'Off' })))).toBe(true)
    expect(clear(bg(screen.getByRole('button', { name: 'Out' })))).toBe(true)
  })

  test('a collapsible title has the tint; a mouse click shows no focus ring, Tab does', async () => {
    setPrefersDark(dark)
    renderWithProviders(<Section question="In progress" collapsible open onToggle={() => {}}><p>x</p></Section>)
    const button = screen.getByRole('button', { name: 'In progress' })
    expect(clear(bg(button))).toBe(false)
    await userEvent.click(button)
    expect(button).not.toHaveClass('Mui-focusVisible')
    await userEvent.tab()
    await userEvent.tab({ shift: true })
    expect(button).toHaveClass('Mui-focusVisible')
  })
})
