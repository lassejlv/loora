import { useEffect, useMemo, useRef, useState } from 'react'
import { ExternalLinkIcon, SearchIcon } from '@loora/ui/icons'
import { Badge } from '@loora/ui/badge'
import { Button } from '@loora/ui/button'
import { Input } from '@loora/ui/input'
import { orpc } from '@loora/rpc/client'
import type { AdminDesign } from '../admin/types'

function formatDate(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value)
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

export function AdminDesigns({ onChanged }: { onChanged: () => void }) {
  const [designs, setDesigns] = useState<AdminDesign[] | null>(null)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const requestId = useRef(0)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 200)
    return () => clearTimeout(timer)
  }, [search])

  const load = useMemo(
    () => async () => {
      const id = ++requestId.current
      try {
        const rows = await orpc.admin.listDesigns({
          search: debouncedSearch || undefined,
        })
        if (id === requestId.current) {
          setDesigns(rows)
          setError('')
        }
      } catch {
        if (id === requestId.current) setError('Could not load designs.')
      }
    },
    [debouncedSearch],
  )

  useEffect(() => {
    void load()
  }, [load])

  async function restrictLinks(item: AdminDesign) {
    if (
      !window.confirm(
        `Restrict "${item.name}"? Its link falls back to owner and invited people only.`,
      )
    ) {
      return
    }
    setBusyId(item.id)
    setError('')
    setStatus('')
    try {
      await orpc.admin.revokeDesignLinks({
        designId: item.id,
        userId: item.userId,
      })
      setDesigns(
        (current) =>
          current?.map((row) =>
            row.id === item.id
              ? { ...row, linkAccess: 'restricted' as const }
              : row,
          ) ?? null,
      )
      setStatus(`Restricted "${item.name}" to its owner and invited people.`)
      onChanged()
    } catch {
      setError(`Could not restrict "${item.name}".`)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Recent designs</h2>
        <div className="relative min-w-48">
          <SearchIcon className="pointer-events-none absolute start-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="ps-7"
            placeholder="Search designs or owner"
            aria-label="Search designs"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>

      {error ? <p className="text-xs text-destructive-foreground">{error}</p> : null}
      {status ? <p className="text-xs text-muted-foreground">{status}</p> : null}

      <div className="divide-y divide-line rounded-md border border-line bg-surface">
        {designs === null ? (
          <p className="p-3 text-xs text-muted-foreground">Loading designs…</p>
        ) : designs.length === 0 ? (
          <p className="p-3 text-xs text-muted-foreground">No designs match this search.</p>
        ) : (
          designs.map((item) => (
            <div
              key={`${item.userId}:${item.id}`}
              className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 truncate text-xs font-medium">
                  {item.name}
                  {item.linkAccess !== 'restricted' ? (
                    <Badge variant="warning">Link {item.linkAccess}</Badge>
                  ) : null}
                  {item.shares > 0 ? <Badge variant="outline">{item.shares} shared</Badge> : null}
                </p>
                <p className="truncate text-2xs text-muted-foreground">
                  {item.ownerEmail} · updated {formatDate(item.updatedAt)} · rev{' '}
                  {item.revision.toLocaleString()}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  size="xs"
                  variant="outline"
                  render={
                    <a href={`/design/${item.id}`} target="_blank" rel="noreferrer">
                      <ExternalLinkIcon data-slot="icon" />
                      Open
                    </a>
                  }
                />
                {item.linkAccess !== 'restricted' ? (
                  <Button
                    size="xs"
                    variant="destructive-outline"
                    disabled={busyId === item.id}
                    onClick={() => void restrictLinks(item)}
                  >
                    {busyId === item.id ? 'Restricting…' : 'Restrict link'}
                  </Button>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  )
}
