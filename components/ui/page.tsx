import Link from "next/link";
import type * as React from "react";

import { ChevronLeft } from "@/components/icons/chevron-left";
import { cn } from "@/lib/utils";

/**
 * Page scaffolding shared by every non-landing surface: one container,
 * one header, one section heading, one empty state, one status screen.
 *
 * Before these existed each page hand-rolled its own `max-w-* px-4 py-*`
 * wrapper and `<h1 className="text-2xl font-semibold">`, so the app had four
 * h1 sizes, six container widths and six empty-state styles. Reach for
 * these instead of writing the classes again; the entrance motion
 * (`.mz-enter*`, app/globals.css) comes with them.
 */

const PAGE_WIDTHS = {
  /** Forms, settings, single-column flows (order confirm, billing). */
  narrow: "max-w-2xl",
  /** Reading-width content: lists, detail pages, the home dashboard. */
  default: "max-w-3xl",
  /** Grids: browse, collections, public profiles. */
  wide: "max-w-7xl",
} as const;

export type PageWidth = keyof typeof PAGE_WIDTHS;

export function Page({
  width = "default",
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & { width?: PageWidth }) {
  return (
    <div
      data-slot="page"
      className={cn(
        "mz-enter mx-auto flex w-full flex-col gap-8 px-4 py-8 sm:py-12",
        PAGE_WIDTHS[width],
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * Page title block. `icon` sits in a glyph badge above the title (never
 * beside it, where a multi-line description would float it off the
 * heading), and `back` renders a quiet link above everything for leaf
 * pages. `actions` align to the title row's baseline edge.
 */
export function PageHeader({
  title,
  description,
  eyebrow,
  icon,
  actions,
  back,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  eyebrow?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  back?: { href: string; label: string };
  className?: string;
}) {
  return (
    <header data-slot="page-header" className={cn("flex flex-col items-start gap-4", className)}>
      {back && (
        <Link
          href={back.href}
          className="-ml-2 inline-flex h-8 w-fit items-center gap-1 rounded-lg pr-2.5 pl-1.5 text-sm text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <ChevronLeft size={14} />
          {back.label}
        </Link>
      )}
      {icon && <PageIcon>{icon}</PageIcon>}
      <div className="flex w-full items-end gap-3">
        <div className="min-w-0 flex-1">
          {eyebrow && (
            <p className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {eyebrow}
            </p>
          )}
          <h1 className="text-2xl leading-7 font-semibold text-balance">
            {title}
          </h1>
          {description && (
            <p className="mt-1 text-sm leading-5 text-pretty text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        )}
      </div>
    </header>
  );
}

/**
 * The glyph badge used by PageHeader, EmptyState and StatusScreen —
 * ChatGPT's IconBadge: a flat soft-gray square, no ring, no shadow, so
 * the glyph is the only thing with weight.
 */
export function PageIcon({
  className,
  size = "md",
  children,
}: {
  className?: string;
  size?: "md" | "lg";
  children: React.ReactNode;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center bg-muted text-foreground",
        size === "md"
          ? "size-10 rounded-[10px] [&_svg:not([class*='size-'])]:size-5"
          : "size-12 rounded-xl [&_svg:not([class*='size-'])]:size-6",
        className
      )}
    >
      {children}
    </span>
  );
}

/** A titled block inside a Page. `action` sits flush right of the heading. */
export function PageSection({
  title,
  description,
  action,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"section">, "title"> & {
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section data-slot="page-section" className={cn("flex flex-col gap-3", className)} {...props}>
      {(title || action) && (
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            {title && <h2 className="text-base leading-6 font-semibold">{title}</h2>}
            {description && (
              <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
            )}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * The one empty state, after ChatGPT's EmptyMessage: a glyph badge, a
 * one-line title, a line of explanation and an optional action, centred
 * and unboxed. Absence shouldn't be louder than content, so there is no
 * well and no illustration.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  bare = false,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  /** Tighter padding when the parent is already a card. */
  bare?: boolean;
}) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "mz-enter flex flex-col items-center px-6 text-center",
        bare ? "py-8" : "py-16",
        className
      )}
    >
      {icon && <PageIcon className="mb-3">{icon}</PageIcon>}
      <p className="text-base leading-6 font-semibold text-balance">{title}</p>
      {description && (
        <p className="mt-1.5 max-w-sm text-sm leading-[1.45] text-pretty text-muted-foreground">
          {description}
        </p>
      )}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

/**
 * Centred message for error, 404 and "nothing here" routes. Same anatomy
 * as EmptyState one size up: the page has nothing else on it, so the
 * message carries a real heading, but it stays a sentence and a way out.
 */
export function StatusScreen({
  icon,
  code,
  title,
  description,
  actions,
  className,
}: {
  icon?: React.ReactNode;
  /** A short tertiary label above the title, e.g. "404". */
  code?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      data-slot="status-screen"
      className={cn(
        "mz-enter mx-auto flex min-h-[70svh] w-full max-w-sm flex-col items-center justify-center px-6 py-16 text-center",
        className
      )}
    >
      {icon && <PageIcon size="lg" className="mb-4">{icon}</PageIcon>}
      {code && (
        <p className="mb-1 font-mono text-xs leading-[18px] text-subtle-foreground tabular-nums">
          {code}
        </p>
      )}
      <h1 className="text-xl leading-[26px] font-semibold text-balance">{title}</h1>
      {description && (
        <p className="mt-2 text-sm leading-[1.45] text-pretty text-muted-foreground">
          {description}
        </p>
      )}
      {actions && <div className="mt-6 flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  );
}

/** Stagger index for `.mz-enter-item` children: `<li {...enterItem(i)}>`. */
export function enterItem(index: number) {
  return {
    className: "mz-enter-item",
    style: { "--mz-i": index } as React.CSSProperties,
  };
}
