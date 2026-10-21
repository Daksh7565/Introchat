import { useEffect, useState } from 'react'

/** The value, but only after it has stopped changing for `delayMs` (e.g. typing). */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const id = window.setTimeout(() => setSettled(value), delayMs)
    return () => window.clearTimeout(id)
  }, [value, delayMs])
  return settled
}
