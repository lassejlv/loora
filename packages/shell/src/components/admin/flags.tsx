import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
} from '@loora/ui/icons'
import { Badge } from '@loora/ui/badge'
import { Button } from '@loora/ui/button'
import { Dialog, DialogHeader, DialogPopup, DialogTitle } from '@loora/ui/dialog'
import { Input } from '@loora/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@loora/ui/table'
import { orpc } from '@loora/rpc/client'
import { cn } from '@loora/ui/utils'
import type { AdminFlag, AdminFlagEvaluation } from '../admin/types'

function flagTypeColor(type: string) {
  if (type === 'bool') return 'text-emerald-600'
  if (type === 'string') return 'text-blue-600'
  if (type === 'number') return 'text-amber-600'
  return 'text-purple-600'
}

function formatValue(value: unknown) {
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

function expressionToText(expr: unknown): string {
  if (!expr || typeof expr !== 'object') return String(expr)
  const e = expr as Record<string, unknown>
  if ('attr' in e && 'op' in e) {
    return `${e.attr} ${e.op} ${JSON.stringify(e.value)}`
  }
  if ('and' in e && Array.isArray(e.and)) {
    return e.and.map(expressionToText).join(' && ')
  }
  if ('or' in e && Array.isArray(e.or)) {
    return e.or.map(expressionToText).join(' || ')
  }
  if ('bucket' in e && 'op' in e) {
    const b = e.bucket as Record<string, unknown>
    return `bucket(${b.attr}) ${e.op} ${e.value}`
  }
  return JSON.stringify(expr)
}

function FlagRow({ flag, onChanged }: { flag: AdminFlag; onChanged: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const [detail, setDetail] = useState<AdminFlag | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [editingDefault, setEditingDefault] = useState(false)
  const [defaultDraft, setDefaultDraft] = useState('')

  const [ruleFormOpen, setRuleFormOpen] = useState(false)
  const [ruleId, setRuleId] = useState('')
  const [ruleExpression, setRuleExpression] = useState('')
  const [ruleValue, setRuleValue] = useState('')

  const [evalContext, setEvalContext] = useState('{}')
  const [evalResult, setEvalResult] = useState<AdminFlagEvaluation | null>(null)
  const [evalBusy, setEvalBusy] = useState(false)

  const [deletingFlag, setDeletingFlag] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState('')

  const loadDetail = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await orpc.admin.flags.get({ name: flag.name })
      setDetail(result)
      setDefaultDraft(formatValue(result.default))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load flag.')
    } finally {
      setBusy(false)
    }
  }, [flag.name])

  useEffect(() => {
    if (expanded && !detail) void loadDetail()
  }, [expanded, detail, loadDetail])

  const saveDefault = async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await orpc.admin.flags.updateDefault({
        name: flag.name,
        default: defaultDraft,
      })
      setDetail(result)
      setEditingDefault(false)
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update default.')
    } finally {
      setBusy(false)
    }
  }

  const addRule = async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await orpc.admin.flags.setRule({
        name: flag.name,
        ruleId: ruleId || `rule-${Date.now()}`,
        expression: ruleExpression,
        value: ruleValue,
      })
      setDetail(result)
      setRuleFormOpen(false)
      setRuleId('')
      setRuleExpression('')
      setRuleValue('')
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add rule.')
    } finally {
      setBusy(false)
    }
  }

  const removeRule = async (ruleId: string) => {
    setBusy(true)
    setError(null)
    try {
      const result = await orpc.admin.flags.unsetRule({ name: flag.name, ruleId })
      setDetail(result)
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not remove rule.')
    } finally {
      setBusy(false)
    }
  }

  const runEvaluate = async () => {
    setEvalBusy(true)
    setError(null)
    try {
      const ctx = JSON.parse(evalContext)
      const result = await orpc.admin.flags.evaluate({ name: flag.name, context: ctx })
      setEvalResult(result)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Evaluation failed.')
    } finally {
      setEvalBusy(false)
    }
  }

  const confirmDelete = async () => {
    setBusy(true)
    setError(null)
    try {
      await orpc.admin.flags.delete({ name: flag.name })
      setDeletingFlag(false)
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete flag.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-muted/50"
        onClick={() => setExpanded((v) => !v)}
      >
        <TableCell className="w-8">
          {expanded ? (
            <ChevronDownIcon className="size-3.5 text-muted-foreground" />
          ) : (
            <ChevronRightIcon className="size-3.5 text-muted-foreground" />
          )}
        </TableCell>
        <TableCell className="font-mono text-xs">{flag.name}</TableCell>
        <TableCell className={cn('font-mono text-xs font-medium', flagTypeColor(flag.type))}>
          {flag.type}
        </TableCell>
        <TableCell className="font-mono text-xs text-muted-foreground">
          {formatValue(flag.default)}
        </TableCell>
        <TableCell>
          {flag.rules.length > 0 ? (
            <Badge variant="secondary">{flag.rules.length} rule{flag.rules.length === 1 ? '' : 's'}</Badge>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </TableCell>
        <TableCell className="text-xs text-muted-foreground">
          {new Date(flag.updatedAt).toLocaleDateString()}
        </TableCell>
      </TableRow>
      {expanded && detail ? (
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableCell colSpan={6} className="p-4">
            <div className="space-y-4">
              {error ? (
                <p className="text-xs text-destructive-foreground">{error}</p>
              ) : null}

              <div className="space-y-1.5">
                <p className="text-2xs font-medium text-muted-foreground">Default value</p>
                {editingDefault ? (
                  <div className="flex items-center gap-2">
                    <Input
                      value={defaultDraft}
                      className="font-mono text-xs"
                      disabled={busy}
                      onChange={(e) => setDefaultDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void saveDefault()
                        if (e.key === 'Escape') setEditingDefault(false)
                      }}
                    />
                    <Button size="xs" disabled={busy} onClick={() => void saveDefault()}>
                      Save
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => setEditingDefault(false)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <code className="text-xs">{formatValue(detail.default)}</code>
                    <Button size="xs" variant="ghost" onClick={() => setEditingDefault(true)}>
                      Edit
                    </Button>
                  </div>
                )}
              </div>

              <div className="space-y-2 border-t pt-3">
                <div className="flex items-center justify-between">
                  <p className="text-2xs font-medium text-muted-foreground">
                    Targeting rules
                  </p>
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setRuleFormOpen((v) => !v)}
                  >
                    <PlusIcon className="size-3" />
                    Add rule
                  </Button>
                </div>
                {ruleFormOpen ? (
                  <div className="space-y-2 rounded-md border bg-background p-3">
                    <div className="grid gap-1.5">
                      <span className="text-2xs text-muted-foreground">Rule ID</span>
                      <Input
                        value={ruleId}
                        placeholder="e.g. admins-only"
                        className="text-xs"
                        onChange={(e) => setRuleId(e.target.value)}
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <span className="text-2xs text-muted-foreground">
                        Expression (JSON)
                      </span>
                      <Input
                        value={ruleExpression}
                        placeholder='{"attr":"is_admin","op":"eq","value":true}'
                        className="font-mono text-xs"
                        onChange={(e) => setRuleExpression(e.target.value)}
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <span className="text-2xs text-muted-foreground">Value to serve</span>
                      <Input
                        value={ruleValue}
                        placeholder="true"
                        className="font-mono text-xs"
                        onChange={(e) => setRuleValue(e.target.value)}
                      />
                    </div>
                    <div className="flex justify-end gap-1">
                      <Button size="xs" variant="ghost" onClick={() => setRuleFormOpen(false)}>
                        Cancel
                      </Button>
                      <Button
                        size="xs"
                        disabled={busy || !ruleExpression || !ruleValue}
                        onClick={() => void addRule()}
                      >
                        Add
                      </Button>
                    </div>
                  </div>
                ) : null}
                {detail.rules.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No targeting rules.</p>
                ) : (
                  <div className="space-y-1.5">
                    {detail.rules.map((rule) => (
                      <div
                        key={rule.id}
                        className="flex items-center gap-2 rounded-md border bg-background px-2.5 py-1.5"
                      >
                        <code className="text-2xs text-muted-foreground">{rule.id}</code>
                        <code className="min-w-0 flex-1 truncate text-xs">
                          {expressionToText(rule.expression)}
                        </code>
                        <code className="text-xs text-muted-foreground">
                          → {formatValue((rule.source as { value: unknown }).value)}
                        </code>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void removeRule(rule.id)}
                          className="text-muted-foreground hover:text-destructive-foreground"
                        >
                          <Trash2Icon className="size-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-2 border-t pt-3">
                <p className="text-2xs font-medium text-muted-foreground">Evaluate</p>
                <div className="flex items-start gap-2">
                  <textarea
                    value={evalContext}
                    onChange={(e) => setEvalContext(e.target.value)}
                    className="min-h-20 flex-1 resize-none rounded-md border bg-background p-2 font-mono text-xs outline-none"
                    placeholder='{"key":"user_123","is_admin":false}'
                  />
                  <Button size="xs" disabled={evalBusy} onClick={() => void runEvaluate()}>
                    {evalBusy ? '…' : 'Evaluate'}
                  </Button>
                </div>
                {evalResult ? (
                  <div className="space-y-1 rounded-md border bg-background p-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-2xs text-muted-foreground">Value:</span>
                      <code className="text-xs">{formatValue(evalResult.value)}</code>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-2xs text-muted-foreground">Reason:</span>
                      <code className="text-xs">{evalResult.reason}</code>
                    </div>
                    {evalResult.trace.length > 0 ? (
                      <div className="space-y-0.5 border-t pt-1.5">
                        {evalResult.trace.map((step, i) => (
                          <div key={i} className="flex items-center gap-2 text-2xs">
                            <span className={step.matched ? 'text-emerald-600' : 'text-muted-foreground'}>
                              {step.matched ? '✓' : '✗'}
                            </span>
                            <code className="text-muted-foreground">{step.ruleId}</code>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className="flex justify-end border-t pt-3">
                {deletingFlag ? (
                  <div className="flex items-center gap-2">
                    <Input
                      value={deleteConfirm}
                      placeholder={`type ${flag.name} to confirm`}
                      className="text-xs"
                      onChange={(e) => setDeleteConfirm(e.target.value)}
                    />
                    <Button
                      size="xs"
                      variant="destructive"
                      disabled={busy || deleteConfirm !== flag.name}
                      onClick={() => void confirmDelete()}
                    >
                      <Trash2Icon className="size-3" />
                      Delete permanently
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => setDeletingFlag(false)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => setDeletingFlag(true)}
                  >
                    <Trash2Icon className="size-3" />
                    Delete flag
                  </Button>
                )}
              </div>
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  )
}

function CreateFlagDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [type, setType] = useState<'bool' | 'string' | 'number' | 'json'>('bool')
  const [defaultValue, setDefaultValue] = useState('false')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setName('')
    setType('bool')
    setDefaultValue('false')
    setError(null)
  }

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      await orpc.admin.flags.create({ name, type, default: defaultValue })
      reset()
      onOpenChange(false)
      onCreated()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create flag.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-md p-0">
        <DialogHeader className="border-b px-4 py-2.5">
          <DialogTitle>Create feature flag</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 p-4">
          {error ? <p className="text-xs text-destructive-foreground">{error}</p> : null}
          <div className="space-y-1.5">
            <p className="text-2xs font-medium text-muted-foreground">Name</p>
            <Input
              value={name}
              placeholder="my-feature"
              className="font-mono text-xs"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <p className="text-2xs font-medium text-muted-foreground">Type</p>
            <div className="flex gap-1">
              {(['bool', 'string', 'number', 'json'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={type === t}
                  className={cn(
                    'h-7 flex-1 rounded-md text-xs font-medium transition-colors',
                    type === t
                      ? 'bg-secondary text-foreground'
                      : 'text-muted-foreground hover:bg-secondary/50',
                  )}
                  onClick={() => {
                    setType(t)
                    if (t === 'bool') setDefaultValue('false')
                    else if (t === 'number') setDefaultValue('100')
                    else if (t === 'json') setDefaultValue('{}')
                    else setDefaultValue('')
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <p className="text-2xs font-medium text-muted-foreground">Default value</p>
            <Input
              value={defaultValue}
              className="font-mono text-xs"
              onChange={(e) => setDefaultValue(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2 border-t pt-3">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={busy || !name}
              onClick={() => void create()}
            >
              {busy ? 'Creating…' : 'Create flag'}
            </Button>
          </div>
        </div>
      </DialogPopup>
    </Dialog>
  )
}

export function AdminFlags({ onChanged }: { onChanged: () => void }) {
  const [flags, setFlags] = useState<AdminFlag[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const requestId = useRef(0)

  const load = useCallback(async () => {
    const id = ++requestId.current
    setLoading(true)
    setError(null)
    try {
      const result = await orpc.admin.flags.list()
      if (requestId.current === id) setFlags(result)
    } catch (cause) {
      if (requestId.current === id) {
        setError(cause instanceof Error ? cause.message : 'Could not load flags.')
      }
    } finally {
      if (requestId.current === id) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Feature flags</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Railway-managed flags. Toggle defaults, add targeting rules, and evaluate per user.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Refresh flags"
            disabled={loading}
            onClick={() => void load()}
          >
            <RefreshCwIcon className={loading ? 'animate-spin' : ''} />
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <PlusIcon className="size-3.5" />
            New flag
          </Button>
        </div>
      </div>

      {error ? <p className="text-xs text-destructive-foreground">{error}</p> : null}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Default</TableHead>
              <TableHead>Rules</TableHead>
              <TableHead>Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-xs text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : flags.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-xs text-muted-foreground">
                  No feature flags yet.
                </TableCell>
              </TableRow>
            ) : (
              flags.map((flag) => (
                <FlagRow
                  key={flag.id}
                  flag={flag}
                  onChanged={() => {
                    void load()
                    onChanged()
                  }}
                />
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <CreateFlagDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => void load()}
      />
    </div>
  )
}