"use client";

import type { Transition } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";

import { cn } from "#/lib/utils.ts";

export interface ChevronRightIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface ChevronRightIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const DEFAULT_TRANSITION: Transition = {
  times: [0, 0.4, 1],
  duration: 0.5,
};

const ChevronRightIcon = forwardRef<
  ChevronRightIconHandle,
  ChevronRightIconProps
>(({ onMouseEnter, onMouseLeave, className, size, ...props }, ref) => {
  const controls = useAnimation();
  const isControlledRef = useRef(false);

  useImperativeHandle(ref, () => {
    isControlledRef.current = true;
    return {
      startAnimation: () => controls.start("animate"),
      stopAnimation: () => controls.start("normal"),
    };
  });

  const handleMouseEnter = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (isControlledRef.current) {
        onMouseEnter?.(e);
      } else {
        controls.start("animate");
      }
    },
    [controls, onMouseEnter]
  );

  const handleMouseLeave = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (isControlledRef.current) {
        onMouseLeave?.(e);
      } else {
        controls.start("normal");
      }
    },
    [controls, onMouseLeave]
  );

  return (
    <div
      className={cn(
        "inline-flex shrink-0 items-center justify-center [&>svg]:block [&>svg]:size-full",
        size == null && "size-[1em]",
        className,
      )}
      style={size != null ? { width: size, height: size } : undefined}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      {...props}
    >
      <svg
        className="size-full"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <motion.path
          animate={controls}
          d="m9 18 6-6-6-6"
          transition={DEFAULT_TRANSITION}
          variants={{
            normal: { x: 0 },
            animate: { x: [0, 2, 0] },
          }}
        />
      </svg>
    </div>
  );
});

ChevronRightIcon.displayName = "ChevronRightIcon";

export { ChevronRightIcon };
