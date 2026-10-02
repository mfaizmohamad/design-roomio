// pgssl.js
// -----------------------------------------------------------------------------
// TLS policy for every PostgreSQL connection this package opens. It lives in its
// own module because BOTH the application pool (db.js) and the migration runner
// (migrate.js) must use it: the migration connection carries the higher-privilege
// DDL credentials, so it is the LAST connection that should fall back to
// plaintext. Copy-pasting the policy into the runner is how the two drift apart
// and one of them quietly stops encrypting.
// -----------------------------------------------------------------------------

/**
 * TLS for the database connection. Hosted Postgres (Neon, Supabase, RDS, Render)
 * requires it, and without it the password and every row cross the network in
 * plaintext. `pg` does NOT infer this from the URL, so it has to be explicit.
 *
 *   PGSSLMODE=require            → TLS, verifying the server certificate (correct default for prod)
 *   PGSSLMODE=no-verify          → TLS, but accept a self-signed cert (managed providers that
 *                                  present their own CA; still encrypted, just unauthenticated)
 *   PGSSLMODE=disable | unset    → no TLS (local socket / plain-http dev)
 *
 * Deliberately NOT defaulted to `rejectUnauthorized: false`: that is the usual
 * copy-paste fix and it silently turns TLS into encryption without authentication,
 * which a man-in-the-middle can defeat.
 *
 * @returns {{ rejectUnauthorized: boolean } | false} `pg`'s `ssl` option.
 */
export function sslConfig() {
  const mode = (process.env.PGSSLMODE ?? '').trim().toLowerCase()
  if (mode === 'require' || mode === 'verify-ca' || mode === 'verify-full') {
    return { rejectUnauthorized: true }
  }
  if (mode === 'no-verify' || mode === 'prefer' || mode === 'allow') {
    return { rejectUnauthorized: false }
  }
  return false
}
