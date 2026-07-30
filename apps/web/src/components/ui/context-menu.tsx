"use client";

import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu";
import { ChevronRightIcon } from "#/components/icons";
import type * as React from "react";
import { cn } from "#/lib/utils.ts";

export const ContextMenu: typeof ContextMenuPrimitive.Root =
  ContextMenuPrimitive.Root;

export const ContextMenuPortal: typeof ContextMenuPrimitive.Portal =
  ContextMenuPrimitive.Portal;

export function ContextMenuTrigger({
  className,
  children,
  ...props
}: ContextMenuPrimitive.Trigger.Props): React.ReactElement {
  return (
    <ContextMenuPrimitive.Trigger
      className={className}
      data-slot="context-menu-trigger"
      {...props}
    >
      {children}
    </ContextMenuPrimitive.Trigger>
  );
}

export function ContextMenuPopup({
  children,
  className,
  sideOffset = 4,
  align = "center",
  alignOffset,
  side = "bottom",
  anchor,
  portalProps,
  ...props
}: ContextMenuPrimitive.Popup.Props & {
  align?: ContextMenuPrimitive.Positioner.Props["align"];
  sideOffset?: ContextMenuPrimitive.Positioner.Props["sideOffset"];
  alignOffset?: ContextMenuPrimitive.Positioner.Props["alignOffset"];
  side?: ContextMenuPrimitive.Positioner.Props["side"];
  anchor?: ContextMenuPrimitive.Positioner.Props["anchor"];
  portalProps?: ContextMenuPrimitive.Portal.Props;
}): React.ReactElement {
  return (
    <ContextMenuPortal {...portalProps}>
      <ContextMenuPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        anchor={anchor}
        className="z-50"
        data-slot="context-menu-positioner"
        side={side}
        sideOffset={sideOffset}
      >
        <ContextMenuPrimitive.Popup
          className={cn(
            "relative flex not-[class*='w-']:min-w-28 origin-(--transform-origin) rounded-md border bg-popover shadow-[0_12px_32px_-24px_rgba(30,29,26,0.45)] outline-none focus:outline-none",
            className,
          )}
          data-slot="context-menu-popup"
          {...props}
        >
          <div className="max-h-(--available-height) w-full overflow-y-auto p-1">
            {children}
          </div>
        </ContextMenuPrimitive.Popup>
      </ContextMenuPrimitive.Positioner>
    </ContextMenuPortal>
  );
}

export function ContextMenuGroup(
  props: ContextMenuPrimitive.Group.Props,
): React.ReactElement {
  return (
    <ContextMenuPrimitive.Group data-slot="context-menu-group" {...props} />
  );
}

const contextMenuItemIconClass =
  // Match Button: size descendant SVG icons and explicit icon slots.
  "[&_[data-slot=icon]:not([class*='size-'])]:size-4 sm:[&_[data-slot=icon]:not([class*='size-'])]:size-3.5 [&_svg:not([class*='opacity-'])]:opacity-72 [&_svg:not([class*='size-'])]:size-4 sm:[&_svg:not([class*='size-'])]:size-3 [&_svg]:pointer-events-none [&_svg]:shrink-0";

export function ContextMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: ContextMenuPrimitive.Item.Props & {
  inset?: boolean;
  variant?: "default" | "destructive";
}): React.ReactElement {
  return (
    <ContextMenuPrimitive.Item
      className={cn(
        "flex min-h-7 cursor-default select-none items-center gap-1.5 rounded-sm px-2 py-1 text-sm text-foreground outline-none data-disabled:pointer-events-none data-highlighted:bg-accent data-inset:ps-7 data-[variant=destructive]:text-destructive-foreground data-highlighted:text-accent-foreground data-disabled:opacity-56 sm:min-h-5.5 sm:text-xs",
        contextMenuItemIconClass,
        className,
      )}
      data-inset={inset}
      data-slot="context-menu-item"
      data-variant={variant}
      {...props}
    />
  );
}

export function ContextMenuLinkItem({
  className,
  inset,
  variant = "default",
  closeOnClick = true,
  ...props
}: ContextMenuPrimitive.LinkItem.Props & {
  inset?: boolean;
  variant?: "default" | "destructive";
}): React.ReactElement {
  return (
    <ContextMenuPrimitive.LinkItem
      className={cn(
        "flex min-h-7 cursor-default select-none items-center gap-1.5 rounded-sm px-2 py-1 text-sm text-foreground outline-none data-disabled:pointer-events-none data-highlighted:bg-accent data-inset:ps-7 data-[variant=destructive]:text-destructive-foreground data-highlighted:text-accent-foreground data-disabled:opacity-56 sm:min-h-5.5 sm:text-xs",
        contextMenuItemIconClass,
        className,
      )}
      closeOnClick={closeOnClick}
      data-inset={inset}
      data-slot="context-menu-link-item"
      data-variant={variant}
      {...props}
    />
  );
}

export function ContextMenuCheckboxItem({
  className,
  children,
  checked,
  variant = "default",
  ...props
}: ContextMenuPrimitive.CheckboxItem.Props & {
  variant?: "default" | "switch";
}): React.ReactElement {
  return (
    <ContextMenuPrimitive.CheckboxItem
      checked={checked}
      className={cn(
        "grid min-h-7 in-data-[side=none]:min-w-[calc(var(--anchor-width)+1rem)] cursor-default items-center gap-1.5 rounded-sm py-1 ps-2 text-sm text-foreground outline-none data-disabled:pointer-events-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:opacity-56 sm:min-h-5.5 sm:text-xs [&_svg:not([class*='size-'])]:size-4 sm:[&_svg:not([class*='size-'])]:size-3 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        variant === "switch"
          ? "grid-cols-[1fr_auto] gap-4 pe-1.5"
          : "grid-cols-[.75rem_1fr] pe-4",
        className,
      )}
      data-slot="context-menu-checkbox-item"
      {...props}
    >
      {variant === "switch" ? (
        <>
          <span className="col-start-1">{children}</span>
          <ContextMenuPrimitive.CheckboxItemIndicator
            className="inset-shadow-[0_1px_--theme(--color-black/4%)] inline-flex h-[calc(var(--thumb-size)+2px)] w-[calc(var(--thumb-size)*2-2px)] shrink-0 items-center rounded-full p-px outline-none transition-[background-color,box-shadow] duration-200 [--thumb-size:--spacing(4)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background data-checked:bg-primary data-unchecked:bg-input data-disabled:opacity-64 sm:[--thumb-size:--spacing(3)]"
            keepMounted
          >
            <span className="pointer-events-none block aspect-square h-full in-[[data-slot=context-menu-checkbox-item][data-checked]]:origin-[var(--thumb-size)_50%] origin-left in-[[data-slot=context-menu-checkbox-item][data-checked]]:translate-x-[calc(var(--thumb-size)-4px)] in-[[data-slot=context-menu-checkbox-item]:active]:not-data-disabled:scale-x-110 in-[[data-slot=context-menu-checkbox-item]:active]:rounded-[var(--thumb-size)/calc(var(--thumb-size)*1.10)] rounded-(--thumb-size) bg-background shadow-sm/5 will-change-transform [transition:translate_.15s,border-radius_.15s,scale_.1s_.1s,transform-origin_.15s]" />
          </ContextMenuPrimitive.CheckboxItemIndicator>
        </>
      ) : (
        <>
          <ContextMenuPrimitive.CheckboxItemIndicator className="col-start-1 -ms-0.5">
            <svg
              aria-hidden="true"
              fill="none"
              height="24"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
              width="24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d="M5.252 12.7 10.2 18.63 18.748 5.37" />
            </svg>
          </ContextMenuPrimitive.CheckboxItemIndicator>
          <span className="col-start-2">{children}</span>
        </>
      )}
    </ContextMenuPrimitive.CheckboxItem>
  );
}

export function ContextMenuRadioGroup(
  props: ContextMenuPrimitive.RadioGroup.Props,
): React.ReactElement {
  return (
    <ContextMenuPrimitive.RadioGroup
      data-slot="context-menu-radio-group"
      {...props}
    />
  );
}

export function ContextMenuRadioItem({
  className,
  children,
  ...props
}: ContextMenuPrimitive.RadioItem.Props): React.ReactElement {
  return (
    <ContextMenuPrimitive.RadioItem
      className={cn(
        "grid min-h-7 in-data-[side=none]:min-w-[calc(var(--anchor-width)+1rem)] cursor-default grid-cols-[.75rem_1fr] items-center gap-1.5 rounded-sm py-1 ps-2 pe-3 text-sm text-foreground outline-none data-disabled:pointer-events-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:opacity-56 sm:min-h-5.5 sm:text-xs [&_svg:not([class*='size-'])]:size-4 sm:[&_svg:not([class*='size-'])]:size-3 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className,
      )}
      data-slot="context-menu-radio-item"
      {...props}
    >
      <ContextMenuPrimitive.RadioItemIndicator className="col-start-1 -ms-0.5">
        <svg
          aria-hidden="true"
          fill="none"
          height="24"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
          width="24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M5.252 12.7 10.2 18.63 18.748 5.37" />
        </svg>
      </ContextMenuPrimitive.RadioItemIndicator>
      <span className="col-start-2">{children}</span>
    </ContextMenuPrimitive.RadioItem>
  );
}

export function ContextMenuGroupLabel({
  className,
  inset,
  ...props
}: ContextMenuPrimitive.GroupLabel.Props & {
  inset?: boolean;
}): React.ReactElement {
  return (
    <ContextMenuPrimitive.GroupLabel
      className={cn(
        "px-2 py-1 font-medium text-xs text-muted-foreground data-inset:ps-8 sm:data-inset:ps-6",
        className,
      )}
      data-inset={inset}
      data-slot="context-menu-label"
      {...props}
    />
  );
}

export function ContextMenuSeparator({
  className,
  ...props
}: ContextMenuPrimitive.Separator.Props): React.ReactElement {
  return (
    <ContextMenuPrimitive.Separator
      className={cn("mx-2 my-1 h-px bg-border", className)}
      data-slot="context-menu-separator"
      {...props}
    />
  );
}

export function ContextMenuShortcut({
  className,
  ...props
}: React.ComponentProps<"kbd">): React.ReactElement {
  return (
    <kbd
      className={cn(
        "ms-auto font-medium font-sans text-muted-foreground/72 text-xs tracking-widest",
        className,
      )}
      data-slot="context-menu-shortcut"
      {...props}
    />
  );
}

export function ContextMenuSub(
  props: ContextMenuPrimitive.SubmenuRoot.Props,
): React.ReactElement {
  return (
    <ContextMenuPrimitive.SubmenuRoot data-slot="context-menu-sub" {...props} />
  );
}

export function ContextMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: ContextMenuPrimitive.SubmenuTrigger.Props & {
  inset?: boolean;
}): React.ReactElement {
  return (
    <ContextMenuPrimitive.SubmenuTrigger
      className={cn(
        "flex min-h-7 items-center gap-1.5 rounded-sm px-2 py-1 text-sm text-foreground outline-none data-disabled:pointer-events-none data-highlighted:bg-accent data-popup-open:bg-accent data-inset:ps-7 data-highlighted:text-accent-foreground data-popup-open:text-accent-foreground data-disabled:opacity-56 sm:min-h-5.5 sm:text-xs",
        contextMenuItemIconClass,
        className,
      )}
      data-inset={inset}
      data-slot="context-menu-sub-trigger"
      {...props}
    >
      {children}
      <ChevronRightIcon className="ms-auto -me-0.5 size-4 opacity-80" data-slot="icon" />
    </ContextMenuPrimitive.SubmenuTrigger>
  );
}

export function ContextMenuSubPopup({
  className,
  sideOffset = 0,
  alignOffset,
  align = "start",
  ...props
}: ContextMenuPrimitive.Popup.Props & {
  align?: ContextMenuPrimitive.Positioner.Props["align"];
  sideOffset?: ContextMenuPrimitive.Positioner.Props["sideOffset"];
  alignOffset?: ContextMenuPrimitive.Positioner.Props["alignOffset"];
}): React.ReactElement {
  const defaultAlignOffset = align !== "center" ? -5 : undefined;

  return (
    <ContextMenuPopup
      align={align}
      alignOffset={alignOffset ?? defaultAlignOffset}
      className={className}
      data-slot="context-menu-sub-content"
      side="inline-end"
      sideOffset={sideOffset}
      {...props}
    />
  );
}

export { ContextMenuPrimitive };
