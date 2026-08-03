import { useMemo } from 'react'
import {
  canvasId,
  type CanvasColor,
  type DesignToken,
} from '@loora/canvas/model'
import {
  useCanvasDocument,
  useCanvasReadOnly,
  useCanvasTransaction,
} from '@loora/canvas/react'
import { PanelEmpty, PanelShell } from '@loora/ui/panel-shell'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@loora/ui/dropdown-menu'
import { PlusIcon, Trash2Icon } from '@loora/ui/icons'
import { Button } from '@loora/ui/button'
import { cn } from '@loora/ui/utils'
import { ColorCell, NumberCell, Section, SelectCell } from './properties-panel'

const TOKEN_TYPES: { type: DesignToken['type']; label: string }[] = [
  { type: 'color', label: 'Color' },
  { type: 'number', label: 'Number' },
  { type: 'font', label: 'Font' },
]

const DEFAULT_VALUE: Record<DesignToken['type'], string | number> = {
  color: '#000000',
  number: 0,
  font: 'Inter, sans-serif',
}

/**
 * How many places reference a token. A token still in use cannot be deleted:
 * the document check requires every `{ token }` colour to resolve, so the
 * engine would reject the transaction whole.
 */
function useTokenUsage(nodes: unknown) {
  return useMemo(() => {
    const serialized = JSON.stringify(nodes)
    return (id: string) => serialized.split(`{"token":"${id}"}`).length - 1
  }, [nodes])
}

export function CanvasTokensPanel({ onClose }: { onClose?: () => void }) {
  const document = useCanvasDocument()
  const transact = useCanvasTransaction()
  const readOnly = useCanvasReadOnly()
  const usageOf = useTokenUsage(document.nodes)

  const themes = Object.values(document.themes)
  // With one theme there is nowhere for a mode to belong, so edits write the
  // token's base value. With several, the panel edits the active theme — which
  // is exactly what the renderer and the exporter read back.
  const themed = themes.length > 1
  const activeTheme = document.themes[document.activeThemeId]
  const tokens = Object.values(document.tokens).sort(
    (left, right) =>
      TOKEN_TYPES.findIndex((entry) => entry.type === left.type) -
        TOKEN_TYPES.findIndex((entry) => entry.type === right.type) ||
      left.name.localeCompare(right.name),
  )

  const upsert = (token: DesignToken, label: string, field?: string) =>
    transact({
      id: canvasId('tx'),
      label,
      ...(field ? { coalesceKey: `token:${token.id}:${field}` } : {}),
      operations: [{ type: 'token.upsert', token }],
    })

  const addToken = (type: DesignToken['type']) => {
    const label = TOKEN_TYPES.find((entry) => entry.type === type)!.label
    let count = tokens.filter((token) => token.type === type).length + 1
    while (document.tokens[`${type}-${count}`]) count += 1
    upsert(
      {
        id: `${type}-${count}`,
        name: `${label} ${count}`,
        type,
        value: DEFAULT_VALUE[type],
      },
      `Add ${label.toLowerCase()} token`,
    )
  }

  const setValue = (token: DesignToken, value: string | number) =>
    upsert(
      themed
        ? {
            ...token,
            modes: { ...token.modes, [document.activeThemeId]: value },
          }
        : { ...token, value },
      `Update ${token.name}`,
      'value',
    )

  /** What this token paints under the theme being edited. */
  const valueOf = (token: DesignToken) =>
    (themed ? token.modes?.[document.activeThemeId] : undefined) ?? token.value

  return (
    <PanelShell
      title="Tokens"
      description={
        themed && activeTheme
          ? `Editing values for ${activeTheme.name}`
          : undefined
      }
      className={cn(readOnly && 'pointer-events-none opacity-70')}
      actions={
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-xs" variant="ghost" aria-label="Add token">
              <PlusIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            {TOKEN_TYPES.map((entry) => (
              <DropdownMenuItem
                key={entry.type}
                onClick={() => addToken(entry.type)}
              >
                {entry.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      }
      onClose={onClose}
    >
      {themed ? (
        <Section title="Theme">
          <SelectCell
            label="Active"
            value={document.activeThemeId}
            onChange={(id) =>
              transact({
                id: canvasId('tx'),
                label: 'Switch theme',
                operations: [{ type: 'theme.activate', id }],
              })
            }
          >
            {themes.map((theme) => (
              <option key={theme.id} value={theme.id}>
                {theme.name}
              </option>
            ))}
          </SelectCell>
        </Section>
      ) : null}

      {tokens.length === 0 ? (
        <PanelEmpty
          title="No tokens yet"
          description="A token is one named value — a brand colour, a radius, a font — that every layer can point at. Add one, then bind a colour to it from the Design panel."
        />
      ) : (
        <Section title="Tokens">
          {tokens.map((token) => {
            const used = usageOf(token.id)
            const value = valueOf(token)
            return (
              <div key={token.id} className="flex items-center gap-1">
                <input
                  key={`${token.id}:${token.name}`}
                  aria-label={`${token.name} name`}
                  defaultValue={token.name}
                  className="h-7 w-24 shrink-0 rounded-md border bg-background px-2 text-xs outline-none focus-within:border-ring"
                  onBlur={(event) => {
                    const name = event.currentTarget.value.trim()
                    if (name && name !== token.name) {
                      upsert({ ...token, name }, 'Rename token')
                    } else {
                      event.currentTarget.value = token.name
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur()
                  }}
                />
                <div className="min-w-0 flex-1">
                  {token.type === 'color' ? (
                    <ColorCell
                      label={token.name}
                      value={typeof value === 'string' ? value : null}
                      onChange={(color: CanvasColor) => {
                        if (typeof color === 'string') setValue(token, color)
                      }}
                    />
                  ) : token.type === 'number' ? (
                    <NumberCell
                      label="Value"
                      value={typeof value === 'number' ? value : null}
                      onCommit={(next) => setValue(token, next)}
                    />
                  ) : (
                    <input
                      key={`${token.id}:${String(value)}`}
                      aria-label={`${token.name} value`}
                      defaultValue={String(value)}
                      className="h-7 w-full min-w-0 rounded-md border bg-background px-2 font-mono text-xs outline-none focus-within:border-ring"
                      onBlur={(event) => {
                        const next = event.currentTarget.value.trim()
                        if (next && next !== String(value)) setValue(token, next)
                        else event.currentTarget.value = String(value)
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') event.currentTarget.blur()
                      }}
                    />
                  )}
                </div>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`Delete ${token.name}`}
                  title={
                    used > 0
                      ? `Used in ${used} place${used === 1 ? '' : 's'} — unbind it first`
                      : `Delete ${token.name}`
                  }
                  disabled={used > 0}
                  onClick={() =>
                    transact({
                      id: canvasId('tx'),
                      label: `Delete ${token.name}`,
                      operations: [{ type: 'token.delete', id: token.id }],
                    })
                  }
                >
                  <Trash2Icon />
                </Button>
              </div>
            )
          })}
        </Section>
      )}
    </PanelShell>
  )
}
