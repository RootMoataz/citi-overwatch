import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button, Dialog, Menu, MenuItem } from '@mui/material'
import { describe, expect, test } from 'vitest'
import Section from '../features/dashboard/Section.jsx'
import { EmploymentDetails } from '../features/people/ProfileCard.jsx'
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

describe.each([['light', false], ['dark', true]])('dialogs and employment details (%s)', (_name, dark) => {
  test('dialog and menu papers have no elevation overlay in dark and keep an edge', () => {
    setPrefersDark(dark)
    renderWithProviders(<>
      <Dialog open><Button>Cancel</Button></Dialog>
      <Menu open anchorEl={document.body}><MenuItem>One</MenuItem></Menu>
    </>)
    const papers = [document.querySelector('.MuiDialog-paper'), document.querySelector('.MuiMenu-paper')]
    for (const paper of papers) {
      if (dark) {
        expect(getComputedStyle(paper).backgroundImage).toBe('none')
        expect(getComputedStyle(paper).borderTopWidth).toBe('1px')
      }
    }
  })

  test('Employment details is tinted; a mouse click shows no ring, Tab does', async () => {
    setPrefersDark(dark)
    renderWithProviders(<EmploymentDetails salary={1} />)
    const button = screen.getByRole('button', { name: /Employment details/ })
    expect(clear(bg(button))).toBe(false)
    await userEvent.click(button)
    expect(button).not.toHaveClass('Mui-focusVisible')
    await userEvent.tab()
    await userEvent.tab({ shift: true })
    expect(button).toHaveClass('Mui-focusVisible')
  })
})
