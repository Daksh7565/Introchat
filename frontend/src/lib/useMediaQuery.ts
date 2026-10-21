import { useCallback, useSyncExternalStore } from 'react'

/** Tailwind's `lg` breakpoint: from here the guest screens use two panes. */
export const DESKTOP_QUERY = '(min-width: 1024px)'

/**
 * Whether a CSS media query currently matches, updating when the window is
 * resized or a tablet is rotated. Used only where behaviour (not just styling)
 * differs by screen size, e.g. opening a chat in a side pane instead of a new
 * screen. Pure styling differences stay in Tailwind classes.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    [query],
  )
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  )
}
