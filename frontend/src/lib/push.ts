import { unwrap } from './rpc'
import { supabase } from './supabase'

/**
 * Where this browser stands with push notifications (ARCHITECTURE §4.14):
 *   unavailable   – this browser cannot receive push, or push is not set up for this build
 *   needs_install – iPhone/iPad in Safari: push works only once the app is on the Home Screen
 *   ask           – can ask for permission (only from a tap: browsers refuse otherwise)
 *   on            – allowed
 *   blocked       – refused; only the browser's own settings can undo it
 */
export type PushAvailability = 'unavailable' | 'needs_install' | 'ask' | 'on' | 'blocked'

// The public half of the VAPID key pair; the private half is an Edge Function
// secret. Empty = push not configured for this build.
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY ?? ''

function isAppleMobile(): boolean {
  // iPadOS reports itself as a Mac; a touch screen gives it away.
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1)
  )
}

function isInstalled(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

export function pushAvailability(): PushAvailability {
  if (VAPID_PUBLIC_KEY === '' || !('serviceWorker' in navigator)) return 'unavailable'
  // Safari on iPhone offers push only to an app opened from the Home Screen.
  if (isAppleMobile() && !isInstalled()) return 'needs_install'
  if (!('PushManager' in window) || !('Notification' in window)) return 'unavailable'
  switch (Notification.permission) {
    case 'granted':
      return 'on'
    case 'denied':
      return 'blocked'
    default:
      return 'ask'
  }
}

// The VAPID key in the binary form PushManager.subscribe() wants.
function keyBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64Url + '='.repeat((4 - (base64Url.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/')
  const raw = atob(base64)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

async function saveSubscription(subscription: PushSubscription): Promise<void> {
  const json = subscription.toJSON()
  unwrap(
    await supabase.rpc('save_push_subscription', {
      p_endpoint: subscription.endpoint,
      p_p256dh: json.keys?.p256dh ?? '',
      p_auth: json.keys?.auth ?? '',
    }),
  )
}

async function currentSubscription(): Promise<PushSubscription> {
  const registration = await navigator.serviceWorker.ready
  return (
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(VAPID_PUBLIC_KEY),
    }))
  )
}

/** Asks for permission (call only from a tap), subscribes, and saves it. Returns the outcome. */
export async function enablePush(): Promise<PushAvailability> {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return pushAvailability()
  await saveSubscription(await currentSubscription())
  return 'on'
}

/**
 * Keeps the server's copy of this browser's subscription current when
 * permission was given earlier (another visit, another account on this phone,
 * or a subscription the browser renewed). Cheap: one upsert.
 */
export async function syncPushSubscription(): Promise<void> {
  if (pushAvailability() !== 'on') return
  await saveSubscription(await currentSubscription())
}
