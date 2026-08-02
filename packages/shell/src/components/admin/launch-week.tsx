import { useEffect, useState } from 'react'
import { orpc } from '@loora/rpc/client'
import { Button } from '@loora/ui/button'
import { Input } from '@loora/ui/input'
import { Label } from '@loora/ui/label'
import { Switch } from '@loora/ui/switch'
import { Textarea } from '@loora/ui/textarea'

type LaunchWeekConfig = Awaited<ReturnType<typeof orpc.admin.launchWeek.get>>

function formatDate(value: string, index: number) {
  const date = new Date(`${value}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + index)
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

export function AdminLaunchWeek() {
  const [config, setConfig] = useState<LaunchWeekConfig | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    void orpc.admin.launchWeek.get()
      .then(setConfig)
      .catch(() => setMessage('Could not load launch week.'))
  }, [])

  if (!config) {
    return <p className="text-xs text-muted-foreground">{message || 'Loading launch week…'}</p>
  }

  const updateDay = (index: number, patch: Partial<LaunchWeekConfig['days'][number]>) => {
    setConfig((current) => {
      if (!current) return current
      const days = [...current.days]
      days[index] = { ...days[index], ...patch }
      return { ...current, days }
    })
  }

  return (
    <section className="rounded-md border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
        <div>
          <h2 className="text-sm font-semibold">Launch week</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Schedule seven daily releases at <span className="font-mono">/launch-week</span>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="launch-week-enabled" className="text-xs">
            {config.enabled ? 'Live' : 'Hidden'}
          </Label>
          <Switch
            id="launch-week-enabled"
            checked={config.enabled}
            onCheckedChange={(enabled) => setConfig({ ...config, enabled })}
          />
        </div>
      </div>

      <div className="space-y-5 p-4">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px]">
          <div className="space-y-1.5">
            <Label htmlFor="launch-week-headline">Headline</Label>
            <Input
              id="launch-week-headline"
              value={config.headline}
              onChange={(event) => setConfig({ ...config, headline: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="launch-week-start">Week starts</Label>
            <Input
              id="launch-week-start"
              type="date"
              nativeInput
              value={config.startDate}
              onChange={(event) => setConfig({ ...config, startDate: event.target.value })}
            />
            <p className="text-2xs text-muted-foreground">Choose a Monday.</p>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="launch-week-description">Introduction</Label>
          <Textarea
            id="launch-week-description"
            value={config.description}
            onChange={(event) => setConfig({ ...config, description: event.target.value })}
          />
        </div>

        <div className="grid gap-px overflow-hidden rounded-md border border-line bg-line lg:grid-cols-2">
          {config.days.map((day, index) => (
            <div key={index} className="space-y-3 bg-surface p-4">
              <div>
                <p className="text-xs font-semibold">{formatDate(config.startDate, index)}</p>
                <p className="text-2xs text-muted-foreground">Day {index + 1}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`launch-day-${index}-title`}>Offer title</Label>
                <Input
                  id={`launch-day-${index}-title`}
                  value={day.title}
                  onChange={(event) => updateDay(index, { title: event.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`launch-day-${index}-description`}>What ships</Label>
                <Textarea
                  id={`launch-day-${index}-description`}
                  size="sm"
                  value={day.description}
                  onChange={(event) => updateDay(index, { description: event.target.value })}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor={`launch-day-${index}-cta`}>Link label</Label>
                  <Input
                    id={`launch-day-${index}-cta`}
                    placeholder="Optional"
                    value={day.ctaLabel}
                    onChange={(event) => updateDay(index, { ctaLabel: event.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`launch-day-${index}-url`}>Link URL</Label>
                  <Input
                    id={`launch-day-${index}-url`}
                    placeholder="/features"
                    value={day.ctaUrl}
                    onChange={(event) => updateDay(index, { ctaUrl: event.target.value })}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3">
          <p className={message.startsWith('Saved') ? 'text-xs text-emerald-600' : 'text-xs text-destructive-foreground'}>
            {message}
          </p>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              setMessage('')
              try {
                const saved = await orpc.admin.launchWeek.save(config)
                setConfig(saved)
                setMessage(saved.enabled ? 'Saved. Launch week is live.' : 'Saved. Launch week is hidden.')
              } catch (cause) {
                setMessage(cause instanceof Error ? cause.message : 'Could not save launch week.')
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? 'Saving…' : 'Save launch week'}
          </Button>
        </div>
      </div>
    </section>
  )
}
