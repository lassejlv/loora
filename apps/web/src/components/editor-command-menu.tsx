import type { ElementType } from 'react'
import { CheckIcon } from '#/components/icons'
import {
  Command,
  CommandCollection,
  CommandDialog,
  CommandDialogPopup,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  CommandShortcut,
} from '#/components/ui/command'

export interface EditorCommand {
  id: string
  label: string
  keywords?: string
  icon: ElementType
  shortcut?: string
  active?: boolean
  disabled?: boolean
  run: () => void
}

export interface EditorCommandGroup {
  label: string
  commands: EditorCommand[]
}

export function EditorCommandMenu({
  open,
  onOpenChange,
  groups,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  groups: EditorCommandGroup[]
}) {
  const items = groups.map((group) => ({
    label: group.label,
    items: group.commands,
  }))

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandDialogPopup aria-label="Command menu">
        <Command
          items={items}
          itemToStringValue={(value) => {
            const command = value as EditorCommand
            return `${command.label} ${command.keywords ?? ''}`
          }}
        >
          <CommandInput placeholder="Search commands…" />
          <CommandPanel>
            <CommandEmpty>No commands found.</CommandEmpty>
            <CommandList>
              {(group) => (
                <CommandGroup key={group.label} items={group.items}>
                  <CommandGroupLabel>{group.label}</CommandGroupLabel>
                  <CommandCollection>
                    {(command: EditorCommand) => {
                      const Icon = command.icon
                      return (
                        <CommandItem
                          key={command.id}
                          value={command}
                          disabled={command.disabled}
                          onClick={() => {
                            onOpenChange(false)
                            command.run()
                          }}
                        >
                          <Icon className="mr-2 size-4 shrink-0 text-muted-foreground" />
                          <span>{command.label}</span>
                          {command.active ? <CheckIcon className="ml-auto size-3.5" /> : null}
                          {command.shortcut ? (
                            <CommandShortcut className={command.active ? 'ml-2' : undefined}>
                              {command.shortcut}
                            </CommandShortcut>
                          ) : null}
                        </CommandItem>
                      )
                    }}
                  </CommandCollection>
                </CommandGroup>
              )}
            </CommandList>
          </CommandPanel>
          <CommandFooter>
            <span>↑↓ Navigate · ↵ Run</span>
            <span>Esc Close</span>
          </CommandFooter>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  )
}
