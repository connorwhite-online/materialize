import Link from "next/link";
import type * as React from "react";

import { ChevronLeft } from "@/components/icons/chevron-left";
import { cn } from "@/lib/utils";

/**
 * Page scaffolding shared by every non-landing surface: one container,
 * one header, one section heading, one empty state, one status screen.
 *
 * Before these existed each page hand-rolled its own `max-w-* px-4 py-*`
 * wrapper and `<h1 className="text-2xl font-bold">`, so the app had four
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
 * Page title block. `icon` sits in a soft tile in front of the title —
 * the same glyph-first identity the mobile nav pill uses — and `back`
 * renders a pill link above it for leaf pages.
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
    <header data-slot="page-header" className={cn("flex flex-col gap-4", className)}>
      {back && (
        <Link
          href={back.href}
          className="-ml-1 inline-flex w-fit items-center gap-1 rounded-full py-1 pr-2.5 pl-1.5 text-sm text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <ChevronLeft size={14} />
          {back.label}
        </Link>
      )}
      <div className="flex items-start gap-3.5">
        {icon && <PageIcon>{icon}</PageIcon>}
        <div className="min-w-0 flex-1">
          {eyebrow && (
            <p className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {eyebrow}
            </p>
          )}
          <h1 className="text-2xl leading-tight font-semibold tracking-tight text-balance">
            {title}
          </h1>
          {description && (
            <p className="mt-1.5 text-sm leading-relaxed text-pretty text-muted-foreground">
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

/** The soft rounded glyph tile used by PageHeader, EmptyState and StatusScreen. */
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
        "flex shrink-0 items-center justify-center bg-card text-foreground shadow-surface ring-1 ring-foreground/8",
        size === "md"
          ? "size-11 rounded-[14px] [&_svg:not([class*='size-'])]:size-5"
          : "size-16 rounded-[20px] [&_svg:not([class*='size-'])]:size-7",
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
            {title && <h2 className="text-sm font-medium">{title}</h2>}
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
 * The one empty state. A glyph tile, a sentence of title, an optional
 * line of explanation and an optional action — inside a quiet well so
 * the absence still has a shape on the page.
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
  /** Drop the well (when the parent is already a card). */
  bare?: boolean;
}) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "mz-enter flex flex-col items-center px-6 py-12 text-center",
        !bare && "rounded-3xl bg-muted/40 ring-1 ring-foreground/5",
        className
      )}
    >
      {icon && <PageIcon className="mz-enter-pop mb-4">{icon}</PageIcon>}
      <p className="text-base font-medium text-balance">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-sm leading-relaxed text-pretty text-muted-foreground">
          {description}
        </p>
      )}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

/**
 * Full-height centered message for error, 404 and "nothing here" routes.
 * The glyph pops in (the one spring in the system) because on these
 * screens the glyph is most of the message.
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
  /** A big faint code behind the glyph, e.g. "404". */
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
        "mx-auto flex min-h-[70svh] w-full max-w-md flex-col items-center justify-center px-6 py-16 text-center",
        className
      )}
    >
      <div className="relative mb-6 flex items-center justify-center">
        {code && (
          <span
            aria-hidden="true"
            className="mz-enter absolute text-[7rem] leading-none font-bold tracking-tighter text-foreground/[0.05] select-none"
          >
            {code}
          </span>
        )}
        {icon && (
          <PageIcon size="lg" className="mz-enter-pop relative">
            {icon}
          </PageIcon>
        )}
      </div>
      <h1
        className="mz-enter-item text-2xl leading-tight font-semibold tracking-tight text-balance"
        style={{ "--mz-i": 1 } as React.CSSProperties}
      >
        {title}
      </h1>
      {description && (
        <p
          className="mz-enter-item mt-2 text-sm leading-relaxed text-pretty text-muted-foreground"
          style={{ "--mz-i": 2 } as React.CSSProperties}
        >
          {description}
        </p>
      )}
      {actions && (
        <div
          className="mz-enter-item mt-7 flex flex-wrap justify-center gap-2"
          style={{ "--mz-i": 3 } as React.CSSProperties}
        >
          {actions}
        </div>
      )}
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
