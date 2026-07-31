import type { ReactNode } from 'react'
import {
  BracesIcon,
  BringToFrontIcon,
  ClipboardPasteIcon,
  CodeXmlIcon,
  ComponentIcon,
  FileCode2Icon,
  GroupIcon,
  RectangleHorizontalIcon,
  ScissorsIcon,
  SendToBackIcon,
  Trash2Icon,
  TypeIcon,
  UngroupIcon,
} from '@loora/ui/icons'
import { CopyIcon, FrameIcon, MaximizeIcon } from '@loora/ui/icons'
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuPopup,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubPopup,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@loora/ui/context-menu'
import type { BuiltInShortcutId } from '#/lib/shortcuts'
import type { CanvasEditorActions } from './editor'

/**
 * Right-click menu over the artboard. The surface has already selected whatever
 * the pointer landed on, so every item here reads the live selection.
 */
export function CanvasContextMenu({
  actions,
  shortcutLabel,
  onZoomToSelection,
  children,
}: {
  actions: CanvasEditorActions
  shortcutLabel: (id: BuiltInShortcutId) => string
  onZoomToSelection: () => void
  children: ReactNode
}) {
  const hasSelection = actions.selection.length > 0

  return (
    <ContextMenu>
      <ContextMenuTrigger className="contents">{children}</ContextMenuTrigger>
      <ContextMenuPopup className="w-56">
        {hasSelection ? (
          <>
            {actions.canEditText ? (
              <ContextMenuItem
                onClick={() => actions.editText(actions.selection[0]!)}
              >
                <TypeIcon data-slot="icon" />
                Edit text
                <ContextMenuShortcut>↵</ContextMenuShortcut>
              </ContextMenuItem>
            ) : null}
            <ContextMenuItem disabled={!actions.canCopy} onClick={actions.copySelection}>
              <CopyIcon data-slot="icon" />
              Copy
              <ContextMenuShortcut>{shortcutLabel('copy')}</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuSub>
              <ContextMenuSubTrigger disabled={!actions.canCopyCode}>
                <CodeXmlIcon data-slot="icon" />
                Copy as
              </ContextMenuSubTrigger>
              <ContextMenuSubPopup className="w-48">
                <ContextMenuItem
                  onClick={() => void actions.copyCode('html')}
                >
                  <FileCode2Icon data-slot="icon" />
                  HTML
                </ContextMenuItem>
                <ContextMenuItem
                  onClick={() => void actions.copyCode('jsx')}
                >
                  <BracesIcon data-slot="icon" />
                  JSX
                </ContextMenuItem>
                <ContextMenuItem
                  onClick={() => void actions.copyCode('tailwind')}
                >
                  <CodeXmlIcon data-slot="icon" />
                  Tailwind
                </ContextMenuItem>
              </ContextMenuSubPopup>
            </ContextMenuSub>
            <ContextMenuItem
              disabled={!actions.canCopy || actions.readOnly}
              onClick={actions.cutSelection}
            >
              <ScissorsIcon data-slot="icon" />
              Cut
              <ContextMenuShortcut>{shortcutLabel('cut')}</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem
              disabled={!actions.canDuplicate}
              onClick={actions.duplicateSelection}
            >
              <CopyIcon data-slot="icon" />
              Duplicate
              <ContextMenuShortcut>{shortcutLabel('duplicate')}</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem disabled={!actions.canGroup} onClick={actions.groupSelection}>
              <GroupIcon data-slot="icon" />
              Group
              <ContextMenuShortcut>{shortcutLabel('group')}</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem
              disabled={!actions.canUngroup}
              onClick={actions.ungroupSelection}
            >
              <UngroupIcon data-slot="icon" />
              Ungroup
              <ContextMenuShortcut>{shortcutLabel('ungroup')}</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuSub>
              <ContextMenuSubTrigger disabled={!actions.canReorder}>
                <BringToFrontIcon data-slot="icon" />
                Arrange
              </ContextMenuSubTrigger>
              <ContextMenuSubPopup className="w-52">
                <ContextMenuItem onClick={() => actions.reorderSelection('front')}>
                  <BringToFrontIcon data-slot="icon" />
                  Bring to front
                  <ContextMenuShortcut>{shortcutLabel('bringToFront')}</ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuItem onClick={() => actions.reorderSelection('forward')}>
                  Bring forward
                  <ContextMenuShortcut>{shortcutLabel('bringForward')}</ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuItem onClick={() => actions.reorderSelection('backward')}>
                  Send backward
                  <ContextMenuShortcut>{shortcutLabel('sendBackward')}</ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuItem onClick={() => actions.reorderSelection('back')}>
                  <SendToBackIcon data-slot="icon" />
                  Send to back
                  <ContextMenuShortcut>{shortcutLabel('sendToBack')}</ContextMenuShortcut>
                </ContextMenuItem>
              </ContextMenuSubPopup>
            </ContextMenuSub>
            <ContextMenuItem onClick={onZoomToSelection}>
              <MaximizeIcon data-slot="icon" />
              Zoom to selection
              <ContextMenuShortcut>{shortcutLabel('zoomToSelection')}</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        ) : null}

        <ContextMenuItem
          disabled={actions.readOnly || !actions.parent}
          onClick={actions.pasteClipboard}
        >
          <ClipboardPasteIcon data-slot="icon" />
          Paste
          <ContextMenuShortcut>{shortcutLabel('paste')}</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger disabled={actions.readOnly || !actions.parent}>
            <FrameIcon data-slot="icon" />
            Insert
          </ContextMenuSubTrigger>
          <ContextMenuSubPopup className="w-48">
            <ContextMenuItem onClick={actions.addFrame}>
              <FrameIcon data-slot="icon" />
              Frame
            </ContextMenuItem>
            <ContextMenuItem onClick={actions.addText}>
              <TypeIcon data-slot="icon" />
              Text
              <ContextMenuShortcut>{shortcutLabel('tool.text')}</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onClick={actions.addShape}>
              <RectangleHorizontalIcon data-slot="icon" />
              Rectangle
              <ContextMenuShortcut>{shortcutLabel('tool.box')}</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onClick={actions.addComponent}>
              <ComponentIcon data-slot="icon" />
              Component
            </ContextMenuItem>
          </ContextMenuSubPopup>
        </ContextMenuSub>

        {hasSelection ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              disabled={actions.readOnly}
              onClick={actions.deleteSelection}
            >
              <Trash2Icon data-slot="icon" />
              Delete
              <ContextMenuShortcut>{shortcutLabel('delete')}</ContextMenuShortcut>
            </ContextMenuItem>
          </>
        ) : null}
      </ContextMenuPopup>
    </ContextMenu>
  )
}
