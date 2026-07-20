import { LoaderCircleIcon } from "#/components/icons";
import type React from "react";
import { cn } from "#/lib/utils.ts";

export function Spinner({
  className,
  ...props
}: React.ComponentProps<typeof LoaderCircleIcon>): React.ReactElement {
  return (
    <LoaderCircleIcon
      aria-label="Loading"
      className={cn("animate-spin", className)}
      role="status"
      {...props}
    />
  );
}
