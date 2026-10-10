import { createBrowserRouter } from 'react-router'
import { AdminPage } from '../features/admin/AdminPage'
import { HomePage } from '../features/home/HomePage'
import { LandingPage } from '../features/landing/LandingPage'
import { NotFoundPage } from './NotFoundPage'
import { RootLayout } from './RootLayout'
import { RouteErrorPage } from './RouteErrorPage'

// URL shapes are part of the product: /v/:slug/t/:token is printed inside every
// QR card on every table. Changing it means reprinting every card.
export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/v/:slug/t/:token', element: <LandingPage /> },
      { path: '/admin/*', element: <AdminPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])
