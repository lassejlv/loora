"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import type React from "react";
import { cn } from "#/lib/utils.ts";

export function Label({
  className,
  render,
  ...props
}: useRender.ComponentProps<"label">): React.ReactElement {
  const defaultProps = {
    className: cn(
      "inline-flex items-center gap-1.5 font-medium text-sm/4 text-foreground sm:text-[11px]/4",
      className,
    ),
    "data-slot": "label",
  };

  return useRender({
    defaultTagName: "label",
    props: mergeProps<"label">(defaultProps, props),
    render,
  });
}
