import { fireEvent, render } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import ScrollHint from './ScrollHint.jsx'

// jsdom has no layout: each test gives the scroller the sizes a browser would.
function sized(el, { scrollWidth, clientWidth, scrollLeft = 0 }) {
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: scrollWidth })
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: clientWidth })
  Object.defineProperty(el, 'scrollLeft', { configurable: true, writable: true, value: scrollLeft })
}
const renderHint = (props) => render(
  <ScrollHint {...props}>{(ref, onScroll) => <div ref={ref} onScroll={onScroll} data-testid="scroller"><table /></div>}</ScrollHint>)
const fades = (container) => [...container.querySelectorAll('[data-scroll-fade]')].map((el) => el.dataset.scrollFade)

describe('ScrollHint', () => {
  test('content that fits shows no fade', () => {
    const { container, getByTestId } = renderHint()
    sized(getByTestId('scroller'), { scrollWidth: 300, clientWidth: 300 })
    fireEvent.scroll(getByTestId('scroller'))
    expect(fades(container)).toEqual([])
  })

  test('wider content fades on the right until scrolled to the end, and on the left once scrolled', () => {
    const { container, getByTestId } = renderHint()
    const scroller = getByTestId('scroller')
    sized(scroller, { scrollWidth: 800, clientWidth: 300 })
    fireEvent.scroll(scroller)
    expect(fades(container)).toEqual(['right'])
    scroller.scrollLeft = 200
    fireEvent.scroll(scroller)
    expect(fades(container)).toEqual(['left', 'right'])
    scroller.scrollLeft = 500
    fireEvent.scroll(scroller)
    expect(fades(container)).toEqual(['left'])
  })

  test('with left={false} (a fixed first column there) only the right edge fades', () => {
    const { container, getByTestId } = renderHint({ left: false })
    const scroller = getByTestId('scroller')
    sized(scroller, { scrollWidth: 800, clientWidth: 300, scrollLeft: 200 })
    fireEvent.scroll(scroller)
    expect(fades(container)).toEqual(['right'])
    expect(container.querySelector('[data-scroll-fade]')).toHaveAttribute('aria-hidden', 'true')
  })
})
