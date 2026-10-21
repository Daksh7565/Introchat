const STORAGE_KEY = 'introchat.deviceId'

// Kept for the life of the page if storage is unavailable (see below).
let memoryId: string | null = null

/**
 * A random id for this browser, kept in localStorage. It only keys rate limits
 * (location_check) and, later, bans as a weak extra signal (ARCHITECTURE §4.2).
 * It identifies nothing about the person and is reset by clearing site data.
 */
export function deviceId(): string {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored && /^[A-Za-z0-9-]{8,64}$/.test(stored)) return stored
    const created = crypto.randomUUID()
    window.localStorage.setItem(STORAGE_KEY, created)
    return created
  } catch {
    // Storage blocked (private mode, site data disabled): use an id for this
    // page only. Rate limits then apply per page load, which is still safe.
    memoryId ??= crypto.randomUUID()
    return memoryId
  }
}
