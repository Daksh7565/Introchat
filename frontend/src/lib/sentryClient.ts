// The only parts of Sentry the app uses, loaded on demand by monitoring.ts.
// `import('@sentry/react')` directly keeps the whole package (the bundler
// cannot tell which exports a dynamic import will use): 145 KB gzipped
// instead of what these two need.
export { captureException, init } from '@sentry/react'
