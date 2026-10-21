import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({ supabase: {} }))

// Which phones can be offered notifications, and how. The browser objects are
// replaced per test; the key is stubbed because push.ts reads it at load time.
const originalAgent = navigator.userAgent

function browser({
  agent = 'Mozilla/5.0 (Linux; Android 14) Chrome/130',
  installed = false,
  permission = 'default' as NotificationPermission | null,
  pushManager = true,
} = {}) {
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: agent })
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {} })
  window.matchMedia = ((query: string) => ({
    matches: installed && query.includes('standalone'),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia
  if (pushManager)
    Object.defineProperty(window, 'PushManager', { configurable: true, value: class {} })
  else Reflect.deleteProperty(window, 'PushManager')
  if (permission)
    Object.defineProperty(window, 'Notification', { configurable: true, value: { permission } })
  else Reflect.deleteProperty(window, 'Notification')
}

async function availability() {
  vi.resetModules()
  const { pushAvailability } = await import('./push')
  return pushAvailability()
}

beforeEach(() => {
  vi.stubEnv('VITE_VAPID_PUBLIC_KEY', 'BTestKey')
})

afterEach(() => {
  vi.unstubAllEnvs()
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: originalAgent })
})

describe('pushAvailability', () => {
  it('can ask on an Android phone that has not decided yet', async () => {
    browser()
    expect(await availability()).toBe('ask')
  })

  it('is on once allowed, and blocked once refused', async () => {
    browser({ permission: 'granted' })
    expect(await availability()).toBe('on')
    browser({ permission: 'denied' })
    expect(await availability()).toBe('blocked')
  })

  it('asks an iPhone in Safari to add the app to the Home Screen first', async () => {
    browser({
      agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
      pushManager: false,
      permission: null,
    })
    expect(await availability()).toBe('needs_install')
  })

  it('can ask an iPhone once opened from the Home Screen', async () => {
    browser({ agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', installed: true })
    expect(await availability()).toBe('ask')
  })

  it('offers nothing in a browser without push, or a build without a key', async () => {
    browser({ pushManager: false })
    expect(await availability()).toBe('unavailable')
    browser()
    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', '')
    expect(await availability()).toBe('unavailable')
  })
})
