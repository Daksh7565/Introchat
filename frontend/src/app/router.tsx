import { createBrowserRouter, type RouteObject } from 'react-router'
import { HomePage } from '../features/home/HomePage'
import { LandingPage } from '../features/landing/LandingPage'
import { AdminRoute, DevPreviewRoute } from './lazyRoutes'
import { NotFoundPage } from './NotFoundPage'
import { RootLayout } from './RootLayout'
import { RouteErrorPage } from './RouteErrorPage'

// The preview route exists only in development builds (see lazyRoutes.tsx).
const devRoutes: RouteObject[] = import.meta.env.DEV
  ? [{ path: '/dev/preview', element: <DevPreviewRoute /> }]
  : []

// URL shapes are part of the product: /v/:slug/t/:token is printed inside every
// QR card on every table. Changing it means reprinting every card.
export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/v/:slug/t/:token', element: <LandingPage /> },
      { path: '/admin/*', element: <AdminRoute /> },
      ...devRoutes,
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])
