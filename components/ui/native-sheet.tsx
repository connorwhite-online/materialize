"use client";

import { useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type PanInfo,
} from "motion/react";
import { cn } from "@/lib/utils";

/**
 * NativeSheet — global bottom-sheet primitive with iOS-native feel:
 * spring slide-up, grabber, dimmed + softly blurred backdrop,
 * drag-to-dismiss with velocity flicks, safe-area padding. Bottom-
 * anchored and full-width on phones; floats as a centered rounded
 * card on larger screens.
 *
 * Not built on the dialog primitive on purpose: this is a distinct
 * surface (payment sheets, pickers, share-style actions) whose feel
 * IS the point — drag physics and spring motion aren't something to
 * bolt onto a fade-in dialog. Use Dialog for confirm/destructive
 * prompts; use NativeSheet for flows.
 *
 * `dismissible={false}` locks the sheet during moments that must not
 * be interrupted (e.g. a payment mid-confirmation): backdrop taps,
 * Escape, and drag all no-op; the grabber hides to signal it.
 */
export interface NativeSheetProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Accessible name for the dialog. Not rendered — bring your own header. */
  ariaLabel: string;
  /** When false, the sheet can't be dismissed by the user. Default true. */
  dismissible?: boolean;
  className?: string;
}

const DRAG_CLOSE_OFFSET = 120;
const DRAG_CLOSE_VELOCITY = 800;

export function NativeSheet({
  open,
  onClose,
  children,
  ariaLabel,
  dismissible = true,
  className,
}: NativeSheetProps) {
  const reducedMotion = useReducedMotion();

  // Latest-value refs so the document-level listeners below don't
  // rebind on every render.
  const dismissibleRef = useRef(dismissible);
  dismissibleRef.current = dismissible;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dismissibleRef.current) onCloseRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    // Scroll lock — the page behind a sheet must not pan.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  const onDragEnd = useCallback(
    (_: unknown, info: PanInfo) => {
      if (!dismissibleRef.current) return;
      if (
        info.offset.y > DRAG_CLOSE_OFFSET ||
        info.velocity.y > DRAG_CLOSE_VELOCITY
      ) {
        onCloseRef.current();
      }
    },
    []
  );

  // Portal to <body> so the sheet escapes any transformed/overflow
  // ancestor (position:fixed is unreliable inside CSS transforms).
  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label={ariaLabel}
        >
          <motion.div
            className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            onClick={dismissible ? onClose : undefined}
          />
          <motion.div
            className={cn(
              "relative w-full sm:max-w-md",
              "bg-card text-card-foreground shadow-2xl",
              "rounded-t-4xl sm:rounded-4xl",
              "border border-border/60",
              "pb-[max(env(safe-area-inset-bottom),1.25rem)]",
              className
            )}
            initial={
              reducedMotion ? { opacity: 0 } : { y: "100%", opacity: 1 }
            }
            animate={reducedMotion ? { opacity: 1 } : { y: 0 }}
            exit={reducedMotion ? { opacity: 0 } : { y: "100%" }}
            transition={
              reducedMotion
                ? { duration: 0.15 }
                : { type: "spring", damping: 30, stiffness: 320, mass: 0.8 }
            }
            drag={dismissible && !reducedMotion ? "y" : false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={onDragEnd}
          >
            {dismissible ? (
              <div className="flex justify-center pt-3 pb-1">
                <div className="h-1.5 w-10 rounded-full bg-foreground/15" />
              </div>
            ) : (
              <div className="pt-4" />
            )}
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
