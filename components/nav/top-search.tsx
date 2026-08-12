"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Command } from "cmdk";
import { AnimatePresence, motion } from "motion/react";
import { Browse } from "@/components/icons/browse";
import { CircleX } from "@/components/icons/circle-x";
import { DottedSpinner } from "@/components/icons/dotted-spinner";
import { Oops } from "@/components/icons/oops";
import { Print } from "@/components/icons/print";
import { UserAvatar } from "@/components/auth/user-avatar";
import { Button } from "@/components/ui/button";
import { useCart } from "@/components/print/cart-context";
import { cn } from "@/lib/utils";
import type {
  SearchHitCollection,
  SearchHitFile,
  SearchHitMaterial,
  SearchHitProject,
  SearchHitUser,
  SearchResponse,
} from "@/app/api/search/route";

/**
 * Center-of-top-bar search. cmdk's inline Command (not Command.Dialog)
 * so results grow out of the pill instead of opening a centered modal.
 * ⌘K / Ctrl+K focuses it; Escape / click-outside collapse it.
 *
 * Filtering is off (`shouldFilter={false}`) — `/api/search` already
 * ranks hits. cmdk still owns keyboard selection, groups, and Enter.
 */
export function TopSearch() {
  const router = useRouter();
  const cart = useCart();
  const cartCount = cart?.itemCount ?? 0;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const trimmed = query.trim();
  const showList = open && trimmed.length > 0;

  useEffect(() => {
    if (!trimmed) {
      setResults(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    const controller = new AbortController();
    const id = window.setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(trimmed)}`,
          { signal: controller.signal }
        );
        if (!res.ok) throw new Error(`search failed ${res.status}`);
        const data = (await res.json()) as SearchResponse;
        setResults(data);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          console.warn("[search] fetch failed", err);
          setResults({
            files: [],
            projects: [],
            collections: [],
            users: [],
            materials: [],
          });
        }
      } finally {
        setLoading(false);
      }
    }, 180);

    return () => {
      window.clearTimeout(id);
      controller.abort();
    };
  }, [trimmed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((wasOpen) => {
          const next = !wasOpen;
          if (next) {
            queueMicrotask(() => inputRef.current?.focus());
          } else {
            setQuery("");
            inputRef.current?.blur();
          }
          return next;
        });
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (
        rootRef.current &&
        !rootRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
        setQuery("");
      }
    };
    const id = window.setTimeout(() => {
      document.addEventListener("pointerdown", onPointer);
    }, 0);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  const clearQuery = () => {
    setQuery("");
    inputRef.current?.focus();
  };

  const go = (href: string) => {
    close();
    router.push(href);
  };

  return (
    <div ref={rootRef} className="min-w-0 flex-1">
      <Command
        shouldFilter={false}
        loop
        label="Search files, materials, and creators"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            close();
          }
        }}
        className={cn(
          "box-border overflow-hidden rounded-3xl bg-gradient-to-t from-neutral-50 to-white p-1 shadow-[0_0_2px_oklch(0_0_0/0.06),0_0_14px_oklch(0_0_0/0.08)] dark:from-neutral-900 dark:to-neutral-800 dark:shadow-[0_0_2px_oklch(0_0_0/0.4),0_0_18px_oklch(0_0_0/0.45)]"
        )}
      >
        <div className="flex h-8 items-center gap-1">
          <div className="flex h-full min-w-0 flex-1 items-center rounded-[16px] bg-muted/80 pl-3 pr-1.5">
            <Browse
              size={16}
              className="mr-2 shrink-0 text-muted-foreground"
            />
            <Command.Input
              ref={inputRef}
              value={query}
              onValueChange={(value) => {
                setQuery(value);
                if (!open) setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              placeholder="Search (⌘K)"
              className="h-full min-w-0 flex-1 bg-transparent text-sm placeholder:text-muted-foreground/60 focus:outline-none"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
            {query.length > 0 && (
              <button
                type="button"
                aria-label="Clear search"
                onMouseDown={(e) => e.preventDefault()}
                onClick={clearQuery}
                className="ml-0.5 flex size-5 shrink-0 items-center justify-center text-muted-foreground/70 transition-colors hover:text-foreground"
              >
                <CircleX size={16} />
              </button>
            )}
          </div>
          <span className="relative flex h-full shrink-0">
            <Button size="sm" className="h-full" render={<Link href="/print" />}>
              <Print size={14} />
              Print
            </Button>
            {cartCount > 0 && (
              <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-primary px-1 py-0.5 text-center text-[0.625rem] font-semibold leading-none text-primary-foreground ring-2 ring-background">
                {cartCount > 99 ? "99+" : cartCount}
                <span className="sr-only"> in cart</span>
              </span>
            )}
          </span>
        </div>

        <AnimatePresence initial={false}>
          {showList && (
            <motion.div
              key="search-results"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
              className="overflow-hidden"
            >
              <Command.List className="max-h-[min(28rem,calc(100dvh-8rem))] overflow-y-auto px-1.5 pt-2 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {loading && (
                  <div
                    role="status"
                    className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground"
                  >
                    <DottedSpinner size={16} className="shrink-0" />
                    <span className="min-w-0 truncate">
                      Searching for {trimmed}
                    </span>
                  </div>
                )}

                {!loading && results && !hasAnyHits(results) && (
                  <Command.Empty className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground">
                    <Oops size={16} className="shrink-0" />
                    No results found
                  </Command.Empty>
                )}

                {!loading && results && hasAnyHits(results) && (
                  <>
                    <HitGroup
                      heading="Projects"
                      hits={results.projects}
                      onSelect={go}
                    />
                    <HitGroup
                      heading="Collections"
                      hits={results.collections}
                      onSelect={go}
                    />
                    <HitGroup
                      heading="Files"
                      hits={results.files}
                      onSelect={go}
                    />
                    <HitGroup
                      heading="Materials"
                      hits={results.materials}
                      onSelect={go}
                    />
                    <HitGroup
                      heading="Creators"
                      hits={results.users}
                      onSelect={go}
                    />
                  </>
                )}
              </Command.List>
            </motion.div>
          )}
        </AnimatePresence>
      </Command>
    </div>
  );
}

const itemClass =
  "flex cursor-pointer items-center rounded-xl px-1 py-0.5 text-sm outline-none data-[selected=true]:bg-muted";

function hasAnyHits(results: SearchResponse): boolean {
  return (
    results.files.length +
      results.projects.length +
      results.collections.length +
      results.users.length +
      results.materials.length >
    0
  );
}

type AnyHit =
  | SearchHitFile
  | SearchHitProject
  | SearchHitCollection
  | SearchHitMaterial
  | SearchHitUser;

function HitGroup({
  heading,
  hits,
  onSelect,
}: {
  heading: string;
  hits: AnyHit[];
  onSelect: (href: string) => void;
}) {
  if (hits.length === 0) return null;
  return (
    <Command.Group
      heading={heading}
      className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-muted-foreground"
    >
      {hits.map((hit) => (
        <Command.Item
          key={`${hit.type}-${hit.id}`}
          value={`${hit.type}:${hit.id}:${hitLabel(hit)}`}
          onSelect={() => onSelect(hitHref(hit))}
          className={itemClass}
        >
          <HitRow hit={hit} />
        </Command.Item>
      ))}
    </Command.Group>
  );
}

function hitHref(hit: AnyHit): string {
  switch (hit.type) {
    case "file":
      return `/files/${hit.slug}`;
    case "project":
      return `/projects/${hit.slug}`;
    case "collection":
      return `/collections/${hit.slug}`;
    case "material":
      return `/materials/${hit.slug}`;
    case "user":
      return `/${hit.username}`;
  }
}

function hitLabel(hit: AnyHit): string {
  switch (hit.type) {
    case "user":
      return hit.displayName || hit.username;
    default:
      return hit.name;
  }
}

function HitRow({ hit }: { hit: AnyHit }) {
  if (hit.type === "user") {
    return (
      <div className="flex min-w-0 items-center gap-2.5 px-1.5 py-1.5">
        <UserAvatar
          seed={hit.username}
          imageUrl={hit.avatarUrl}
          displayName={hit.displayName}
          className="h-9 w-9"
        />
        <div className="min-w-0">
          <p className="truncate font-medium">
            {hit.displayName || hit.username}
          </p>
          {hit.displayName && (
            <p className="truncate text-xs text-muted-foreground">
              @{hit.username}
            </p>
          )}
        </div>
      </div>
    );
  }

  const thumb =
    hit.type === "material"
      ? hit.featuredImage
        ? resolveCatalogImage(hit.featuredImage)
        : null
      : hit.type === "collection"
        ? null
        : hit.thumbnailUrl;

  const meta =
    hit.type === "file"
      ? hit.creatorDisplayName || hit.creatorUsername || ""
      : hit.type === "material"
        ? hit.groupName
        : `${hit.fileCount} ${hit.fileCount === 1 ? "file" : "files"}`;

  return (
    <div className="flex min-w-0 items-center gap-2.5 px-1.5 py-1.5">
      <div className="relative size-9 shrink-0 overflow-hidden rounded-md border border-border bg-muted/60">
        {thumb && (
          <Image
            src={thumb}
            alt=""
            fill
            sizes="36px"
            className="object-cover"
          />
        )}
      </div>
      <div className="min-w-0">
        <p className="truncate font-medium">{hit.name}</p>
        {meta && (
          <p className="truncate text-xs text-muted-foreground">{meta}</p>
        )}
      </div>
    </div>
  );
}

function resolveCatalogImage(path: string): string {
  if (path.startsWith("http")) return path;
  return `https://res.cloudinary.com/all3dp/image/upload/w_200,q_auto,f_auto/${path}`;
}
