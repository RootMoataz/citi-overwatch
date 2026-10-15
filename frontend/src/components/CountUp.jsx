import { animate } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { EASE, useCalmMotion } from '../lib/motion.js'

const wholeNumber = (v) => Math.round(v).toLocaleString('en-US')

/** A number that counts up to `value` (and glides on later changes). `format` turns the running number into text.
 * Reduced motion shows the final value straight away. */
export default function CountUp({ value, format = wholeNumber, duration = 0.6 }) {
  const calm = useCalmMotion()
  const target = Number(value)
  const animatable = !calm && Number.isFinite(target)
  const [shown, setShown] = useState(0)
  const current = useRef(0)

  useEffect(() => {
    if (!animatable) return undefined
    const controls = animate(current.current, target, {
      duration, ease: EASE,
      onUpdate: (v) => { current.current = v; setShown(v) },
    })
    return () => controls.stop()
  }, [animatable, target, duration])

  if (!Number.isFinite(target)) return <>{value}</>
  return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{format(animatable ? shown : target)}</span>
}
