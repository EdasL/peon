import { useState, useEffect, useRef } from "react"

/**
 * Keeps a value visible for a minimum duration after it goes null/undefined,
 * returning a `fading` flag during the grace period for CSS transitions.
 */
export function useStickyValue<T>(
  value: T | null | undefined,
  minDisplayMs: number,
): { value: T | null; fading: boolean } {
  const [display, setDisplay] = useState<T | null>(null)
  const [fading, setFading] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const hasValueRef = useRef(false)

  useEffect(() => {
    if (value != null) {
      clearTimeout(timerRef.current)
      setDisplay(value as T)
      setFading(false)
      hasValueRef.current = true
    } else if (hasValueRef.current) {
      hasValueRef.current = false
      setFading(true)
      timerRef.current = setTimeout(() => {
        setDisplay(null)
        setFading(false)
      }, minDisplayMs)
    }
    return () => clearTimeout(timerRef.current)
  }, [value, minDisplayMs])

  return { value: display, fading }
}
