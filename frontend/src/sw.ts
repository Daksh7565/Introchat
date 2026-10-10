import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
  type PrecacheEntry,
} from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

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

// UpdatePrompt sends SKIP_WAITING only after the user taps "Update now", so a
// new version never takes over in the middle of a chat on its own.
self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const data: unknown = event.data
  if (typeof data === 'object' && data !== null && 'type' in data && data.type === 'SKIP_WAITING') {
    void self.skipWaiting()
  }
})
