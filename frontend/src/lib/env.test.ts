import { describe, expect, it, vi } from 'vitest'

// env.ts validates import.meta.env when it is imported; give the module a
// valid configuration so importing it for parseEnv does not throw.
vi.stubEnv('VITE_SUPABASE_URL', 'https://abcdefghijklmnop.supabase.co')
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'public-anon-key')

const { parseEnv } = await import('./env')

describe('parseEnv', () => {
  it('accepts a hosted Supabase URL and a key', () => {
    expect(
      parseEnv({
        VITE_SUPABASE_URL: ' https://kckjteuwwhqifiofyeii.supabase.co ',
        VITE_SUPABASE_ANON_KEY: 'key',
      }),
    ).toEqual({ supabaseUrl: 'https://kckjteuwwhqifiofyeii.supabase.co', supabaseAnonKey: 'key' })
  })

  it('names every missing variable at once', () => {
    expect(() => parseEnv({})).toThrow(
      /VITE_SUPABASE_URL is not set\n- VITE_SUPABASE_ANON_KEY is not set/,
    )
  })

  it.each([
    'http://kckjteuwwhqifiofyeii.supabase.co',
    'https://example.com',
    'https://kckjteuwwhqifiofyeii.supabase.co/',
  ])('rejects %s', (url) => {
    expect(() => parseEnv({ VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: 'key' })).toThrow(
      /VITE_SUPABASE_URL must look like/,
    )
  })
})
