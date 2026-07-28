import { cva, type VariantProps } from "class-variance-authority";
import type React from "react";
import { cn } from "#/lib/utils.ts";

const emptyMediaVariants = cva(
  "flex shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    defaultVariants: {
      variant: "default",
    },
    variants: {
      variant: {
        default: "bg-transparent",
        icon: "relative flex size-8 shrink-0 items-center justify-center rounded-sm border bg-card text-foreground [&_svg:not([class*='size-'])]:size-4",
      },
    },
  },
);

export function Empty({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 flex-col items-center justify-center gap-4 text-balance px-4 py-10 text-center md:py-14",
        className,
      )}
      data-slot="empty"
      {...props}
    />
  );
}

export function EmptyHeader({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className={cn(
        "flex max-w-sm flex-col items-center text-center",
        className,
      )}
      data-slot="empty-header"
      {...props}
    />
  );
}

export function EmptyMedia({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> &
  VariantProps<typeof emptyMediaVariants>): React.ReactElement {
  return (
    <div
      className={cn("relative mb-4", className)}
      data-slot="empty-media"
      data-variant={variant}
      {...props}
    >
      {variant === "icon" && (
        <>
          <div
            aria-hidden="true"
            className={cn(
              emptyMediaVariants({ className, variant }),
              "pointer-events-none absolute bottom-px origin-bottom-left -translate-x-0.5 -rotate-10 scale-84 shadow-none",
            )}
          />
          <div
            aria-hidden="true"
            className={cn(
              emptyMediaVariants({ className, variant }),
              "pointer-events-none absolute bottom-px origin-bottom-right translate-x-0.5 rotate-10 scale-84 shadow-none",
            )}
          />
        </>
      )}
      <div
        className={cn(emptyMediaVariants({ className, variant }))}
        {...props}
      />
    </div>
  );
}

export function EmptyTitle({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className={cn("font-heading font-semibold text-base", className)}
      data-slot="empty-title"
      {...props}
    />
  );
}

export function EmptyDescription({
  className,
  ...props
}: React.ComponentProps<"p">): React.ReactElement {
  return (
    <div
      className={cn(
        "text-xs text-muted-foreground [&>a:hover]:text-primary [&>a]:underline [&>a]:underline-offset-4 [[data-slot=empty-title]+&]:mt-1",
        className,
      )}
      data-slot="empty-description"
      {...props}
    />
  );
}

export function EmptyContent({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className={cn(
        "flex w-full min-w-0 max-w-sm flex-col items-center gap-3 text-balance text-xs",
        className,
      )}
      data-slot="empty-content"
      {...props}
    />
  );
}
