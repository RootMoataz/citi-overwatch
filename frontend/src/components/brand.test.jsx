import { screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { renderAsUser, renderWithProviders, users } from '../test/render.jsx'
import BrandLogo from './BrandLogo.jsx'
import CountUp from './CountUp.jsx'
import { PrintHeader } from './PrintButton.jsx'
import StatTile from './StatTile.jsx'

describe('brand', () => {
  test('the full logo names ACME Scout once for screen readers', () => {
    renderWithProviders(<BrandLogo />)
    const logo = screen.getByRole('img', { name: 'ACME Scout' })
    expect(logo).toHaveTextContent('ACME')
    expect(logo).toHaveTextContent('Scout')
  })

  test('the glyph-only logo keeps the same accessible name', () => {
    renderWithProviders(<BrandLogo variant="glyph" />)
    const logo = screen.getByRole('img', { name: 'ACME Scout' })
    expect(logo).not.toHaveTextContent('Scout')
  })

  test('printed pages are headed ACME Scout', () => {
    renderAsUser(<PrintHeader title="Delivery dashboard" />, { user: users.manager })
    expect(screen.getByText('ACME Scout')).toBeInTheDocument()
  })
})

describe('CountUp', () => {
  test('shows the final value straight away when motion is reduced', () => {
    renderWithProviders(<CountUp value={1234} format={(v) => `$${v.toLocaleString('en-US')}`} />)
    expect(screen.getByText('$1,234')).toBeInTheDocument()
  })

  test('rounds to whole numbers by default', () => {
    renderWithProviders(<CountUp value={7} />)
    expect(screen.getByText('7')).toBeInTheDocument()
  })
})

describe('StatTile', () => {
  test('shows label, value and hint, counting numbers up', () => {
    renderWithProviders(<StatTile label="At-risk projects" value={4} hint="2 more than last week" />)
    expect(screen.getByText('At-risk projects')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByText('2 more than last week')).toBeInTheDocument()
  })

  test('passes text values through unchanged', () => {
    renderWithProviders(<StatTile label="Predicted end" value="Nov 3, 2026" />)
    expect(screen.getByText('Nov 3, 2026')).toBeInTheDocument()
  })
})
