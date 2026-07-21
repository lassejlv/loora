import type { ElementType } from 'react'
import { CheckIcon } from '#/components/icons'
import {
  Command,
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
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandDialogPopup aria-label="Command menu">
        <Command>
          <CommandInput placeholder="Search commands…" />
          <CommandPanel>
            <CommandEmpty>No commands found.</CommandEmpty>
            <CommandList>
              {groups.map((group) => (
                <CommandGroup key={group.label}>
                  <CommandGroupLabel>{group.label}</CommandGroupLabel>
                  {group.commands.map((command) => {
                    const Icon = command.icon
                    return (
                      <CommandItem
                        key={command.id}
                        value={`${command.label} ${command.keywords ?? ''}`}
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
                  })}
                </CommandGroup>
              ))}
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
