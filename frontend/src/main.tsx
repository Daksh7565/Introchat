import '@fontsource/noto-sans/400.css'
import '@fontsource/noto-sans/600.css'
import '@fontsource/noto-sans-devanagari/400.css'
import '@fontsource/noto-sans-devanagari/600.css'
import '@fontsource/noto-sans-gujarati/400.css'
import '@fontsource/noto-sans-gujarati/600.css'
import './index.css'
import './i18n'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppProviders } from './app/AppProviders'
import { initMonitoring, rootErrorHandlers } from './lib/monitoring'

// First, so errors during the first render are reported too.
initMonitoring()

const rootElement = document.getElementById('root')
if (!rootElement) {
  // index.html is ours; a missing #root means a broken build, and failing
  // loudly beats rendering a blank page with no error.
  throw new Error('Root element #root not found in index.html')
}

createRoot(rootElement, rootErrorHandlers).render(
  <StrictMode>
    <AppProviders />
  </StrictMode>,
)
