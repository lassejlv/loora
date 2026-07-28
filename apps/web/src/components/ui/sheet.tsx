"use client";

import { Dialog as SheetPrimitive } from "@base-ui/react/dialog";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { XIcon } from "#/components/icons";
import type React from "react";
import { cn } from "#/lib/utils.ts";
import { Button } from "#/components/ui/button.tsx";
import { ScrollArea } from "#/components/ui/scroll-area.tsx";

export const Sheet: typeof SheetPrimitive.Root = SheetPrimitive.Root;

export const SheetPortal: typeof SheetPrimitive.Portal = SheetPrimitive.Portal;

export function SheetTrigger(
  props: SheetPrimitive.Trigger.Props,
): React.ReactElement {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

export function SheetClose(
  props: SheetPrimitive.Close.Props,
): React.ReactElement {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

export function SheetBackdrop({
  className,
  ...props
}: SheetPrimitive.Backdrop.Props): React.ReactElement {
  return (
    <SheetPrimitive.Backdrop
      className={cn(
        "fixed inset-0 z-50 bg-black/32 backdrop-blur-sm transition-all duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0",
        className,
      )}
      data-slot="sheet-backdrop"
      {...props}
    />
  );
}

export function SheetViewport({
  className,
  side,
  variant = "default",
  ...props
}: SheetPrimitive.Viewport.Props & {
  side?: "right" | "left" | "top" | "bottom";
  variant?: "default" | "inset";
}): React.ReactElement {
  return (
    <SheetPrimitive.Viewport
      className={cn(
        "fixed inset-0 z-50 grid",
        side === "bottom" && "grid grid-rows-[1fr_auto] pt-12",
        side === "top" && "grid grid-rows-[auto_1fr] pb-12",
        side === "left" && "flex justify-start",
        side === "right" && "flex justify-end",
        variant === "inset" && "sm:p-4",
        className,
      )}
      data-slot="sheet-viewport"
      {...props}
    />
  );
}

export function SheetPopup({
  className,
  children,
  showCloseButton = true,
  side = "right",
  variant = "default",
  closeProps,
  portalProps,
  ...props
}: SheetPrimitive.Popup.Props & {
  showCloseButton?: boolean;
  side?: "right" | "left" | "top" | "bottom";
  variant?: "default" | "inset";
  closeProps?: SheetPrimitive.Close.Props;
  portalProps?: SheetPrimitive.Portal.Props;
}): React.ReactElement {
  return (
    <SheetPortal {...portalProps}>
      <SheetBackdrop />
      <SheetViewport side={side} variant={variant}>
        <SheetPrimitive.Popup
          className={cn(
            "relative flex max-h-full min-h-0 w-full min-w-0 flex-col bg-popover text-popover-foreground shadow-[0_18px_48px_-28px_rgba(30,29,26,0.45)] transition-[opacity,translate] duration-160 ease-out will-change-transform data-ending-style:opacity-0 data-starting-style:opacity-0",
            side === "bottom" &&
              "row-start-2 border-t data-ending-style:translate-y-8 data-starting-style:translate-y-8",
            side === "top" &&
              "border-b data-ending-style:-translate-y-8 data-starting-style:-translate-y-8",
            side === "left" &&
              "w-[calc(100%-(--spacing(12)))] max-w-md border-e data-ending-style:-translate-x-8 data-starting-style:-translate-x-8",
            side === "right" &&
              "col-start-2 w-[calc(100%-(--spacing(12)))] max-w-md border-s data-ending-style:translate-x-8 data-starting-style:translate-x-8",
            variant === "inset" &&
              "sm:rounded-lg sm:border sm:**:data-[slot=sheet-footer]:rounded-b-[calc(var(--radius-lg)-1px)]",
            className,
          )}
          data-slot="sheet-popup"
          {...props}
        >
          {children}
          {showCloseButton && (
            <SheetPrimitive.Close
              aria-label="Close"
              className="absolute end-2 top-2"
              render={<Button size="icon" variant="ghost" />}
              {...closeProps}
            >
              <XIcon />
            </SheetPrimitive.Close>
          )}
        </SheetPrimitive.Popup>
      </SheetViewport>
    </SheetPortal>
  );
}

export function SheetHeader({
  className,
  render,
  ...props
}: useRender.ComponentProps<"div">): React.ReactElement {
  const defaultProps = {
    className: cn(
      "flex flex-col gap-1.5 p-4 in-[[data-slot=sheet-popup]:has([data-slot=sheet-panel])]:pb-2 max-sm:pb-3",
      className,
    ),
    "data-slot": "sheet-header",
  };

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

export function SheetFooter({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"div"> & {
  variant?: "default" | "bare";
}): React.ReactElement {
  const defaultProps = {
    className: cn(
      "flex flex-col-reverse gap-1.5 px-4 sm:flex-row sm:justify-end",
      variant === "default" && "border-t bg-muted/45 py-3",
      variant === "bare" &&
        "in-[[data-slot=sheet-popup]:has([data-slot=sheet-panel])]:pt-2 pt-3 pb-4",
      className,
    ),
    "data-slot": "sheet-footer",
  };

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

export function SheetTitle({
  className,
  ...props
}: SheetPrimitive.Title.Props): React.ReactElement {
  return (
    <SheetPrimitive.Title
      className={cn(
        "font-heading font-semibold text-base leading-none",
        className,
      )}
      data-slot="sheet-title"
      {...props}
    />
  );
}

export function SheetDescription({
  className,
  ...props
}: SheetPrimitive.Description.Props): React.ReactElement {
  return (
    <SheetPrimitive.Description
      className={cn("text-xs text-muted-foreground", className)}
      data-slot="sheet-description"
      {...props}
    />
  );
}

export function SheetPanel({
  className,
  scrollFade = true,
  render,
  ...props
}: useRender.ComponentProps<"div"> & {
  scrollFade?: boolean;
}): React.ReactElement {
  const defaultProps = {
    className: cn(
      "p-4 in-[[data-slot=sheet-popup]:has([data-slot=sheet-header])]:pt-1 in-[[data-slot=sheet-popup]:has([data-slot=sheet-footer]:not(.border-t))]:pb-1",
      className,
    ),
    "data-slot": "sheet-panel",
  };

  return (
    <ScrollArea scrollFade={scrollFade}>
      {useRender({
        defaultTagName: "div",
        props: mergeProps<"div">(defaultProps, props),
        render,
      })}
    </ScrollArea>
  );
}

export {
  SheetPrimitive,
  SheetBackdrop as SheetOverlay,
  SheetPopup as SheetContent,
};
