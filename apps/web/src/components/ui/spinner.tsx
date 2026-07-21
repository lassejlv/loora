import type React from 'react'
import { cn } from '#/lib/utils.ts'

export function Spinner({
  className,
  ...props
}: React.ComponentProps<'svg'>): React.ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-label="Loading"
      role="status"
      className={cn(
        'size-4 shrink-0 text-current motion-safe:animate-[spin_0.7s_linear_infinite] motion-reduce:animate-none',
        className,
      )}
      {...props}
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeOpacity="0.18"
        strokeWidth="2.5"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  )
}
