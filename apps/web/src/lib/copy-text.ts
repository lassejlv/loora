/**
 * Writes text to the clipboard, falling back to a hidden textarea where the
 * async API is unavailable — it needs a secure context, and a self-hosted
 * install on plain HTTP would otherwise have no copy button at all.
 */
export async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }
  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  textarea.remove()
}
