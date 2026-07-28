export function isPreviewAccessRequired(
  value: string | null | undefined = process.env.REQUIRE_PREVIEW_ACCESS,
) {
  return value?.trim().toLowerCase() !== 'false'
}

export function canUseApp(
  user: { isAdmin?: boolean | null; previewAccess?: boolean | null },
  required = isPreviewAccessRequired(),
) {
  return !required || user.isAdmin === true || user.previewAccess === true
}

export function previewAccessRequiredResponse() {
  return Response.json(
    { error: 'Preview access is required.', code: 'PREVIEW_ACCESS_REQUIRED' },
    { status: 403 },
  )
}

export function isPreviewProtectedAuthPath(pathname: string) {
  return pathname === '/api/auth/checkout' || pathname.startsWith('/api/auth/customer/')
}
