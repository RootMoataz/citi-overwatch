import { expect } from 'vitest'

// jsdom's getComputedStyle ignores @media rules, so a responsive sx value ({ xs: 44, md: 'auto' }) can't be read from it.
// This reads the emitted rules of one element's own generated class, separately for the base rule and the md block.
const MD = /min-width:\s*900px/
const XS = /^\(min-width:\s*0(px)?\)$/   // MUI wraps the smallest breakpoint in this block

/** The values `prop` takes on `el`'s own class (plus `within`, e.g. ' .MuiToggleButton-root' for a nested selector):
 * { base } from the unconditional rules, { md } from the rules inside the min-width: 900px block. */
export function ruleValues(el, prop, within = '') {
  const wanted = new Set([...el.classList].filter((c) => c.startsWith('css-')).map((c) => `.${CSS.escape(c)}${within}`))
  const hit = (rule) => rule.selectorText?.split(',').some((s) => wanted.has(s.trim()))
  const out = { base: undefined, md: undefined }
  const walk = (rules, inMd) => {
    for (const rule of rules) {
      if (rule.media) {
        if (MD.test(rule.media.mediaText)) walk(rule.cssRules, true)
        else if (XS.test(rule.media.mediaText.trim())) walk(rule.cssRules, inMd)
      } else if (hit(rule)) {
        const value = rule.style.getPropertyValue(prop)
        if (value) out[inMd ? 'md' : 'base'] = value
      }
    }
  }
  for (const sheet of document.styleSheets) walk(sheet.cssRules, false)
  return out
}

/** Asserts a phone-only target: `prop` is `phone` in the base rule and released (auto or 0) from md up. An unconditional
 * 44 px (a desktop change) fails on the md half. */
export function expectPhoneTarget(el, prop = 'min-height', { phone = '44px', within = '' } = {}) {
  const v = ruleValues(el, prop, within)
  expect(v.base, `${prop} below md`).toBe(phone)
  expect(['auto', '0', '0px'], `${prop} released from md`).toContain(v.md)
}
