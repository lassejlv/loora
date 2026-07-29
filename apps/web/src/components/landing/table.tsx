/**
 * The ruled tables both public pages use. Dashed 1px cells, no tinted cards, and
 * a horizontal scroll region on narrow screens so no column is ever dropped.
 */

export function TableScroll({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className="mt-5 overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      <table className="w-full min-w-[520px] border-collapse text-left text-[13px]">{children}</table>
    </div>
  )
}

export function Th({ children }: { children: React.ReactNode }) {
  return (
    <th scope="col" className="border border-dashed border-border px-3 py-2 font-semibold">
      {children}
    </th>
  )
}

export function Td({
  children,
  muted = false,
  strong = false,
}: {
  children: React.ReactNode
  muted?: boolean
  strong?: boolean
}) {
  const tone = muted ? ' text-muted-foreground' : strong ? ' font-medium' : ''
  return <td className={`border border-dashed border-border px-3 py-2${tone}`}>{children}</td>
}
