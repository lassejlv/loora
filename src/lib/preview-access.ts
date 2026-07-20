export function isPreviewAccessRequired(value = process.env.REQUIRE_PREVIEW_ACCESS) {
  return value?.trim().toLowerCase() !== 'false'
}

export function canUseApp(
  user: { isAdmin?: boolean | null; previewAccess?: boolean | null },
  required = isPreviewAccessRequired(),
) {
  return !required || user.isAdmin === true || user.previewAccess === true
}
