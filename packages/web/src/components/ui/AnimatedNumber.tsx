import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"

interface AnimatedNumberProps {
  value: number
  duration?: number
  format?: (n: number) => string
  className?: string
}

/**
 * Smoothly animates a number from its previous value to the new value
 * using requestAnimationFrame with ease-out cubic easing.
 */
export function AnimatedNumber({
  value,
  duration = 500,
  format = String,
  className = "",
}: AnimatedNumberProps) {
  const [displayValue, setDisplayValue] = useState(value)
  const prevValue = useRef(value)
  const frameRef = useRef<number | undefined>(undefined)
  const startTimeRef = useRef<number>(0)

  useEffect(() => {
    const startValue = prevValue.current
    const diff = value - startValue

    if (diff === 0) return

    if (frameRef.current !== undefined) {
      cancelAnimationFrame(frameRef.current)
    }

    startTimeRef.current = performance.now()

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTimeRef.current
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      const current = startValue + diff * eased

      setDisplayValue(Math.round(current))

      if (progress < 1) {
        frameRef.current = requestAnimationFrame(animate)
      } else {
        setDisplayValue(value)
      }
    }

    frameRef.current = requestAnimationFrame(animate)
    prevValue.current = value

    return () => {
      if (frameRef.current !== undefined) {
        cancelAnimationFrame(frameRef.current)
      }
    }
  }, [value, duration])

  return (
    <span className={cn("tabular-nums", className)}>{format(displayValue)}</span>
  )
}
