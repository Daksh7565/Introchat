import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import '../i18n'

// jsdom implements no layout, so it has no scrollIntoView; browsers do. Stubbed
// so components that keep the newest chat message in view can render in tests.
Element.prototype.scrollIntoView = () => undefined

// jsdom has no matchMedia either. Every query answers "no match", so screens
// render their phone layout in tests unless a test replaces this.
window.matchMedia = (query: string) =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }) satisfies MediaQueryList

// Vitest globals are off, so Testing Library cannot register its own cleanup.
afterEach(() => {
  cleanup()
})
