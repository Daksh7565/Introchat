import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
  type PrecacheEntry,
} from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { notificationFromPush } from './i18n/pushNotification'

declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<PrecacheEntry | string>
}

// The app shell (HTML, JS, CSS) is precached so an installed app opens
// instantly even on a weak restaurant connection. Fonts are deliberately not
// precached: @fontsource ships one file per script subset and the browser only
// downloads the subsets a page actually uses (unicode-range), then keeps them in
// its HTTP cache; precaching would force every subset onto every phone.
// Data is never cached here: sessions, people and chats always come live from
// the server.
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// Every navigation (/v/..., /admin, ...) is a client-side route of the same
// single-page app, so all of them are served the precached index.html.
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')))

// Push notifications (ARCHITECTURE §4.14). The server sends facts only and the
// text comes from the app's translation files (pushNotification). Never message text.
self.addEventListener('push', (event: PushEvent) => {
  let data: unknown = null
  try {
    data = event.data?.json()
  } catch {
    // Not ours or malformed: show nothing rather than a broken notification.
  }
  const shown = notificationFromPush(data)
  if (!shown) return
  // renotify is missing from TypeScript's NotificationOptions but supported by
  // Chrome and Android: a new message in the same chat replaces the old
  // notification and still alerts, instead of updating it silently.
  const options: NotificationOptions & { renotify: boolean } = {
    body: shown.body,
    tag: shown.tag,
    renotify: true,
    icon: '/pwa-192x192.png',
    badge: '/pwa-64x64.png',
    data: { url: shown.url },
  }
  event.waitUntil(self.registration.showNotification(shown.title, options))
})

// Tapping a notification brings the open app forward, or opens it.
self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close()
  const data: unknown = event.notification.data
  const url =
    typeof data === 'object' && data !== null && 'url' in data && typeof data.url === 'string'
      ? data.url
      : '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows[0]
      return open ? open.focus() : self.clients.openWindow(url)
    }),
  )
})

// UpdatePrompt sends SKIP_WAITING only after the user taps "Update now", so a
// new version never takes over in the middle of a chat on its own.
self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const data: unknown = event.data
  if (typeof data === 'object' && data !== null && 'type' in data && data.type === 'SKIP_WAITING') {
    void self.skipWaiting()
  }
})
