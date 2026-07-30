/**
 * Is `raw` a path that is guaranteed to stay on this origin?
 *
 * Notification rows carry a `url` written by DB triggers ("/reservations/<id>").
 * Three places hand that stored value to a navigation primitive: the in-app list
 * (NotificationsPage), the push-tap bridge (PushNavigate) and the service
 * worker's notificationclick → openWindow. All three have to agree on what
 * counts as safe, so the rule lives here once instead of being re-typed — and
 * drifting — at each call site.
 *
 * What gets rejected, and why:
 *
 *   "//evil.com"    Protocol-relative. The browser keeps the current scheme and
 *                   replaces the HOST, so it leaves the origin entirely.
 *   "/\evil.com"    Browsers normalise "\" to "/" in special schemes, making
 *                   this equivalent to "//evil.com". This is the CVE-2025-68470
 *                   bypass, which a plain !startsWith("//") check lets through.
 *   "/\t/evil.com"  The URL parser strips TAB/LF/CR from ANYWHERE in the input
 *                   before parsing, so control characters can reassemble into a
 *                   leading "//" after the check has already passed.
 *   "https://…"     Absolute. Anything not starting with "/" — including
 *                   "javascript:" — fails the leading-slash test.
 *
 * This is a structural guard rather than an allowlist of known routes, on
 * purpose: a notification type added by a future trigger keeps working, while
 * the same-origin guarantee holds no matter which path is introduced. It is
 * also independent of the router version, so the protection does not regress
 * if react-router is upgraded, downgraded or swapped out.
 */
export function isSafeInAppPath(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length === 0) return false;

  // Control characters are checked by code point rather than a regex literal so
  // this file needs no eslint control-character exemption. TAB/LF/CR are the
  // dangerous ones; reject the whole C0 range plus DEL rather than trying to
  // predict how the URL parser will rewrite each one.
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return false;
  }

  // A backslash never appears in a path we generate, and every use of one here
  // is an attempt to have it re-read as "/". Reject them outright.
  if (raw.includes('\\')) return false;

  // Must be root-relative, and must not begin a second slash (protocol-relative).
  if (raw[0] !== '/') return false;
  if (raw[1] === '/') return false;

  return true;
}
