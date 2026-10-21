import { lazy, Suspense } from 'react'

// Screens loaded on demand, each as its own bundle. Kept apart from router.tsx
// so that file exports only the router (React Fast Refresh needs component
// files to export only components).

// The Admin Console: guests' phones never download it.
const AdminPage = lazy(() => import('../features/admin/AdminPage'))

export function AdminRoute() {
  return (
    <Suspense fallback={null}>
      <AdminPage />
    </Suspense>
  )
}

// Development only: a click-through of the guest screens with sample data.
// import.meta.env.DEV is replaced with `false` in production builds, so this
// branch and the whole preview chunk are dropped from what guests download.
const DevPreviewPage = import.meta.env.DEV
  ? lazy(() => import('../dev/preview/PreviewPage').then((m) => ({ default: m.PreviewPage })))
  : null

export function DevPreviewRoute() {
  return DevPreviewPage ? (
    <Suspense fallback={null}>
      <DevPreviewPage />
    </Suspense>
  ) : null
}
