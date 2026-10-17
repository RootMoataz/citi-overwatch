// jsdom's getComputedStyle ignores @media rules, so a responsive sx value ({ xs: 44, md: 'auto' }) can't be read from it.
// This returns the CSS text of every rule (media blocks included) that targets one of the element's classes.
export function cssFor(el) {
  const classes = [...el.classList].map((c) => `.${CSS.escape(c)}`)
  const out = []
  const walk = (rules) => {
    for (const rule of rules) {
      if (rule.cssRules?.length && !rule.selectorText) walk(rule.cssRules)
      if (rule.selectorText || rule.cssRules) {
        const text = rule.cssText
        if (classes.some((c) => text.includes(c))) out.push(text)
      }
    }
  }
  for (const sheet of document.styleSheets) walk(sheet.cssRules)
  return out.join('\n')
}
// True when the element's own styles give it min-height: 44px from the smallest breakpoint, and release it at md.
export const hasPhoneTarget = (el) => /min-height:\s*44px/.test(cssFor(el))
