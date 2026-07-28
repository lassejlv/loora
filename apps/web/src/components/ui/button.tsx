"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "#/lib/utils.ts";
import { Spinner } from "#/components/ui/spinner.tsx";

export const buttonVariants = cva(
  "relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md border font-medium text-sm outline-none transition-colors pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-56 data-loading:select-none data-loading:text-transparent sm:text-xs [&_svg:not([class*='opacity-'])]:opacity-72 [&_svg:not([class*='size-'])]:size-4 sm:[&_svg:not([class*='size-'])]:size-3.5 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      size: {
        default: "h-8 px-[calc(--spacing(2.5)-1px)] sm:h-7",
        icon: "size-8 sm:size-7",
        "icon-lg": "size-9 sm:size-8",
        "icon-sm": "size-7 sm:size-6",
        "icon-xl":
          "size-10 sm:size-9 [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4",
        "icon-xs":
          "size-6 rounded-sm sm:size-5.5 not-in-data-[slot=input-group]:[&_svg:not([class*='size-'])]:size-3.5 sm:not-in-data-[slot=input-group]:[&_svg:not([class*='size-'])]:size-3",
        lg: "h-9 px-[calc(--spacing(3)-1px)] sm:h-8",
        sm: "h-7 gap-1 px-[calc(--spacing(2)-1px)] sm:h-6",
        xl: "h-10 px-[calc(--spacing(3.5)-1px)] text-base sm:h-9 sm:text-sm [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4",
        xs: "h-6 gap-1 rounded-sm px-[calc(--spacing(1.5)-1px)] text-xs sm:h-5.5 sm:text-[11px] [&_svg:not([class*='size-'])]:size-3.5 sm:[&_svg:not([class*='size-'])]:size-3",
      },
      variant: {
        default:
          "border-primary bg-primary text-primary-foreground hover:bg-primary/88 data-pressed:bg-primary/84 *:data-[slot=button-loading-indicator]:text-primary-foreground",
        destructive:
          "border-destructive bg-destructive text-white hover:bg-destructive/90 data-pressed:bg-destructive/84 *:data-[slot=button-loading-indicator]:text-white",
        "destructive-outline":
          "border-input bg-background/80 text-destructive-foreground hover:border-destructive/32 hover:bg-destructive/4 data-pressed:border-destructive/32 data-pressed:bg-destructive/4 *:data-[slot=button-loading-indicator]:text-foreground dark:bg-input/24",
        ghost:
          "border-transparent text-foreground hover:bg-accent data-pressed:bg-accent *:data-[slot=button-loading-indicator]:text-foreground",
        link: "border-transparent text-foreground underline-offset-4 hover:underline data-pressed:underline *:data-[slot=button-loading-indicator]:text-foreground",
        outline:
          "border-input bg-background/80 text-foreground hover:border-border hover:bg-accent data-pressed:bg-accent *:data-[slot=button-loading-indicator]:text-foreground dark:bg-input/24 dark:data-pressed:bg-input/48 dark:hover:bg-input/48",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/90 data-pressed:bg-secondary/90 *:data-[slot=button-loading-indicator]:text-secondary-foreground [:active,[data-pressed]]:bg-secondary/80",
      },
    },
  },
);

export interface ButtonProps extends useRender.ComponentProps<"button"> {
  variant?: VariantProps<typeof buttonVariants>["variant"];
  size?: VariantProps<typeof buttonVariants>["size"];
  loading?: boolean;
}

export function Button({
  className,
  variant,
  size,
  render,
  children,
  loading = false,
  disabled: disabledProp,
  ...props
}: ButtonProps): React.ReactElement {
  const isDisabled: boolean = Boolean(loading || disabledProp);
  const typeValue: React.ButtonHTMLAttributes<HTMLButtonElement>["type"] =
    render ? undefined : "button";

  const defaultProps = {
    children: (
      <>
        {children}
        {loading && (
          <Spinner
            className="pointer-events-none absolute"
            data-slot="button-loading-indicator"
          />
        )}
      </>
    ),
    className: cn(buttonVariants({ className, size, variant })),
    "aria-disabled": loading || undefined,
    "data-loading": loading ? "" : undefined,
    "data-slot": "button",
    disabled: isDisabled,
    type: typeValue,
  };

  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(defaultProps, props),
    render,
  });
}
