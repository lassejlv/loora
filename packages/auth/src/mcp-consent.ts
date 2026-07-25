/**
 * Force the MCP consent screen.
 *
 * Better Auth's MCP plugin only renders `consentPage` when the *client* asks
 * for it (`prompt=consent` on /api/auth/mcp/authorize); otherwise it mints the
 * authorization code and redirects straight back. Most MCP clients never send
 * the parameter, so connecting silently granted an OAuth token that can read
 * and edit every design in the account. Granting that must be an explicit act,
 * so the prompt is added server-side before the plugin sees the request — the
 * client cannot opt out of it.
 */

const MCP_AUTHORIZE_PATH = '/api/auth/mcp/authorize'

export function isMcpAuthorizePath(pathname: string) {
  return pathname === MCP_AUTHORIZE_PATH
}

/** `prompt` is a space-delimited set; `none` means "never interact", which is exactly what we override. */
export function withConsentPrompt(prompt: string | null): string {
  const tokens = (prompt ?? '').split(/\s+/).filter((token) => token && token !== 'none')
  if (!tokens.includes('consent')) tokens.push('consent')
  return tokens.join(' ')
}

/**
 * Returns the request to hand to Better Auth: unchanged for everything except
 * an MCP authorize call, which gains `prompt=consent`.
 */
export function requireMcpConsent(request: Request): Request {
  const url = new URL(request.url)
  if (!isMcpAuthorizePath(url.pathname)) return request
  const forced = withConsentPrompt(url.searchParams.get('prompt'))
  if (url.searchParams.get('prompt') === forced) return request
  url.searchParams.set('prompt', forced)
  return new Request(url, request)
}
