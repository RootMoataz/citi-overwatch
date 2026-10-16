import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import Section from './Section.jsx'

describe('Section', () => {
  test('a collapsible section exposes aria-expanded and aria-controls and calls onToggle', async () => {
    const onToggle = vi.fn()
    render(<Section question="In progress (2)" collapsible open onToggle={onToggle} id="s1" buttonLabel="In progress, 2 milestones">
      <p>Body text</p>
    </Section>)
    const button = screen.getByRole('button', { name: 'In progress, 2 milestones' })
    expect(button).toHaveAttribute('aria-expanded', 'true')
    const body = screen.getByText('Body text').parentElement
    expect(button.getAttribute('aria-controls')).toBe(body.id)
    await userEvent.click(button)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  test('collapsed: the children go, the heading, hint and button name stay', () => {
    render(<Section question="Completed · 3" hint="A hint" collapsible open={false} onToggle={() => {}} buttonLabel="Completed, 3 milestones">
      <p>Body text</p>
    </Section>)
    expect(screen.queryByText('Body text')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Completed · 3' })).toBeInTheDocument()
    expect(screen.getByText('A hint')).toBeInTheDocument()
    const button = screen.getByRole('button', { name: 'Completed, 3 milestones' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(document.getElementById(button.getAttribute('aria-controls'))).toBeEmptyDOMElement()
  })

  test('a plain section has no button, as on the dashboard', () => {
    render(<Section question="Who is busy?"><p>Body text</p></Section>)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Who is busy?' })).toBeInTheDocument()
    expect(screen.getByText('Body text')).toBeVisible()
  })
})
