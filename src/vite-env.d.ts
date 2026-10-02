/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Public demo only: Sentry DSN. Unset ⇒ error reporting is off (see src/demo/monitoring.ts). */
  readonly VITE_SENTRY_DSN?: string
  /** Public demo only: release id attached to error reports (CI sets the git SHA). */
  readonly VITE_RELEASE?: string
}
