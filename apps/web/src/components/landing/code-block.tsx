import { useEffect, useRef, useState } from 'react'

/**
 * A copyable snippet. Setup instructions are only useful if the reader can take
 * them away in one click, so the copy control is part of the block rather than a
 * hover affordance that never appears on touch.
 */
export function CodeBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
    } catch {
      return
    }
    setCopied(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className="mt-3 border border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-1.5">
        <span className="truncate text-[11px] text-muted-foreground">{label ?? 'shell'}</span>
        <button
          type="button"
          onClick={copy}
          className="shrink-0 border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto px-3 py-2.5 text-[12px] leading-[1.65]">
        <code>{code}</code>
      </pre>
    </div>
  )
}
