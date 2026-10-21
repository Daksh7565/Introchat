import { describe, expect, it, vi } from 'vitest'

// env.ts validates import.meta.env when it is imported; give the module a
// valid configuration so importing it for parseEnv does not throw.
vi.stubEnv('VITE_SUPABASE_URL', 'https://abcdefghijklmnop.supabase.co')
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'public-anon-key')
vi.stubEnv('VITE_PUBLIC_APP_URL', 'https://introchat.pages.dev')

const { parseEnv } = await import('./env')

const valid = {
  VITE_SUPABASE_URL: 'https://kckjteuwwhqifiofyeii.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'key',
  VITE_PUBLIC_APP_URL: 'https://introchat.pages.dev',
}

describe('parseEnv', () => {
  it('accepts a complete configuration', () => {
    expect(parseEnv({ ...valid, VITE_SUPABASE_URL: ` ${valid.VITE_SUPABASE_URL} ` })).toEqual({
      supabaseUrl: 'https://kckjteuwwhqifiofyeii.supabase.co',
      supabaseAnonKey: 'key',
      publicAppUrl: 'https://introchat.pages.dev',
    })
  })

  it('names every missing variable at once', () => {
    expect(() => parseEnv({})).toThrow(
      /VITE_SUPABASE_URL is not set\n- VITE_SUPABASE_ANON_KEY is not set\n- VITE_PUBLIC_APP_URL is not set/,
    )
  })

  it.each([
    'http://kckjteuwwhqifiofyeii.supabase.co',
    'https://example.com',
    'https://kckjteuwwhqifiofyeii.supabase.co/',
  ])('rejects Supabase URL %s', (url) => {
    expect(() => parseEnv({ ...valid, VITE_SUPABASE_URL: url })).toThrow(
      /VITE_SUPABASE_URL must look like/,
    )
  })

  it('normalises the public app URL to its origin', () => {
    expect(parseEnv({ ...valid, VITE_PUBLIC_APP_URL: 'https://introchat.in/' }).publicAppUrl).toBe(
      'https://introchat.in',
    )
  })

  it('allows plain http only on a local network address', () => {
    expect(
      parseEnv({ ...valid, VITE_PUBLIC_APP_URL: 'http://192.168.1.20:5173' }).publicAppUrl,
    ).toBe('http://192.168.1.20:5173')
    expect(() => parseEnv({ ...valid, VITE_PUBLIC_APP_URL: 'http://introchat.in' })).toThrow(
      /must use https/,
    )
  })

  it('rejects a URL with a path, which would break every QR link', () => {
    expect(() => parseEnv({ ...valid, VITE_PUBLIC_APP_URL: 'https://introchat.in/app' })).toThrow(
      /origin only/,
    )
  })
})
