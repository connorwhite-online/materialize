"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/auth/user-avatar";
import type {
  SearchHitCollection,
  SearchHitFile,
  SearchHitMaterial,
  SearchHitProject,
  SearchHitUser,
  SearchResponse,
} from "@/app/api/search/route";
import { FileCard } from "@/components/files/file-card";

interface SearchResultsPanelProps {
  results: SearchResponse | null;
  loading: boolean;
  query: string;
  onNavigate: () => void;
}

/**
 * Renders the three horizontal carousels of search hits shown
 * above the home bottom bar while the user is typing. Each
 * section only renders if it has at least one hit; empty
 * categories are hidden so the panel resizes to fit.
 */
export function SearchResultsPanel({
  results,
  loading,
  query,
  onNavigate,
}: SearchResultsPanelProps) {
  const totalResults = results
    ? results.files.length +
      results.projects.length +
      results.collections.length +
      results.users.length +
      results.materials.length
    : 0;
  const anyResults = totalResults > 0;

  // Polite live region phrase, deduped to the search phase so the
  // count is announced once it settles rather than on every keystroke
  // as the debounced fetch resolves. Empty query → silent. See CON-62.
  const liveMessage = useMemo(() => {
    if (loading && !results) return "Searching…";
    if (!results) return "";
    if (!anyResults) return `No results for "${query}"`;
    return `${totalResults} ${totalResults === 1 ? "result" : "results"} for "${query}"`;
  }, [loading, results, anyResults, totalResults, query]);

  const liveRegion = <SearchLiveRegion message={liveMessage} />;

  if (loading && !results) {
    return (
      <>
        {liveRegion}
        <SearchResultsSkeleton />
      </>
    );
  }

  if (!results) return liveRegion;

  if (!anyResults) {
    return (
      <div className="px-3 pt-2 pb-3">
        {liveRegion}
        <p className="text-xs text-muted-foreground">
          No results for &ldquo;{query}&rdquo;
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 px-2 pt-2 pb-3">
      {liveRegion}
      {results.projects.length > 0 && (
        <Section title="Projects">
          {results.projects.map((hit) => (
            <ProjectCard key={hit.id} hit={hit} onNavigate={onNavigate} />
          ))}
        </Section>
      )}

      {results.collections.length > 0 && (
        <Section title="Collections">
          {results.collections.map((hit) => (
            <CollectionCard key={hit.id} hit={hit} onNavigate={onNavigate} />
          ))}
        </Section>
      )}

      {results.files.length > 0 && (
        <Section title="Files">
          {results.files.map((hit) => (
            <SearchFileCard key={hit.id} hit={hit} onNavigate={onNavigate} />
          ))}
        </Section>
      )}

      {results.materials.length > 0 && (
        <Section title="Materials">
          {results.materials.map((hit) => (
            <MaterialCard key={hit.id} hit={hit} onNavigate={onNavigate} />
          ))}
        </Section>
      )}

      {results.users.length > 0 && (
        <Section title="Creators">
          {results.users.map((hit) => (
            <UserCard key={hit.id} hit={hit} onNavigate={onNavigate} />
          ))}
        </Section>
      )}
    </div>
  );
}

/**
 * Visually-hidden polite live region for search status. The panel
 * unmounts/remounts across its loading/empty/results branches, so we
 * keep the announced text in local state and only push a new value
 * when it actually changes — that prevents a re-announce when the
 * surrounding branch swaps but the phase phrase is unchanged.
 */
function SearchLiveRegion({ message }: { message: string }) {
  const [announced, setAnnounced] = useState(message);
  const lastRef = useRef(message);
  useEffect(() => {
    if (message !== lastRef.current) {
      lastRef.current = message;
      setAnnounced(message);
    }
  }, [message]);
  return (
    <div role="status" aria-live="polite" className="sr-only">
      {announced}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="mb-1.5 px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <div className="flex gap-2 overflow-x-auto px-2 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {children}
      </div>
    </div>
  );
}

function SearchFileCard({
  hit,
  onNavigate,
}: {
  hit: SearchHitFile;
  onNavigate: () => void;
}) {
  return (
    <FileCard
      compact
      href={`/files/${hit.slug}`}
      onNavigate={onNavigate}
      title={hit.name}
      thumbnailUrl={hit.thumbnailUrl}
      subtitle={hit.creatorDisplayName || hit.creatorUsername || ""}
    />
  );
}

function ProjectCard({
  hit,
  onNavigate,
}: {
  hit: SearchHitProject;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={`/projects/${hit.slug}`}
      onClick={onNavigate}
      className="group flex w-28 shrink-0 flex-col gap-1.5"
    >
      <div className="relative aspect-square overflow-hidden rounded-lg border border-border bg-muted/60">
        {hit.thumbnailUrl ? (
          <Image
            src={hit.thumbnailUrl}
            alt=""
            fill
            sizes="112px"
            className="object-cover transition-transform group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground/60">
            Project
          </div>
        )}
      </div>
      <div className="min-w-0 px-0.5">
        <p className="truncate text-xs font-medium group-hover:text-primary">
          {hit.name}
        </p>
        <p className="truncate text-[10px] text-muted-foreground">
          {hit.fileCount} {hit.fileCount === 1 ? "file" : "files"}
          {(hit.creatorDisplayName || hit.creatorUsername) && " · "}
          {hit.creatorDisplayName || hit.creatorUsername || ""}
        </p>
      </div>
    </Link>
  );
}

function CollectionCard({
  hit,
  onNavigate,
}: {
  hit: SearchHitCollection;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={`/collections/${hit.slug}`}
      onClick={onNavigate}
      className="group flex w-28 shrink-0 flex-col gap-1.5"
    >
      <div className="flex aspect-square w-full items-center justify-center rounded-lg border border-border bg-muted/60 text-[10px] text-muted-foreground/60">
        Collection
      </div>
      <div className="min-w-0 px-0.5">
        <p className="truncate text-xs font-medium group-hover:text-primary">
          {hit.name}
        </p>
        <p className="truncate text-[10px] text-muted-foreground">
          {hit.fileCount} {hit.fileCount === 1 ? "file" : "files"}
          {(hit.creatorDisplayName || hit.creatorUsername) && " · "}
          {hit.creatorDisplayName || hit.creatorUsername || ""}
        </p>
      </div>
    </Link>
  );
}

function MaterialCard({
  hit,
  onNavigate,
}: {
  hit: SearchHitMaterial;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={`/materials/${hit.slug}`}
      onClick={onNavigate}
      className="group flex w-28 shrink-0 flex-col gap-1.5"
    >
      <div className="relative aspect-square overflow-hidden rounded-lg border border-border bg-muted/60">
        {hit.featuredImage && (
          <Image
            src={resolveCatalogImage(hit.featuredImage)}
            alt=""
            fill
            sizes="112px"
            className="object-cover transition-transform group-hover:scale-105"
          />
        )}
      </div>
      <div className="min-w-0 px-0.5">
        <p className="truncate text-xs font-medium group-hover:text-primary">
          {hit.name}
        </p>
      </div>
    </Link>
  );
}

function UserCard({
  hit,
  onNavigate,
}: {
  hit: SearchHitUser;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={`/${hit.username}`}
      onClick={onNavigate}
      className="group flex w-28 shrink-0 flex-col items-center gap-1.5"
    >
      <UserAvatar
        seed={hit.username}
        imageUrl={hit.avatarUrl}
        displayName={hit.displayName}
        className="h-16 w-16"
      />
      <div className="min-w-0 px-0.5 text-center">
        <p className="truncate text-xs font-medium group-hover:text-primary">
          {hit.displayName || hit.username}
        </p>
        {hit.displayName && (
          <p className="truncate text-[10px] text-muted-foreground">
            @{hit.username}
          </p>
        )}
      </div>
    </Link>
  );
}

/**
 * Single-section skeleton sized to match exactly one Section + cards
 * row in the real results. We render only ONE section (vs the 3-4
 * the real panel can produce) so the container never SHRINKS as
 * real data lands — it grows to fit additional sections, which
 * reads better than a confident-looking placeholder collapsing.
 *
 * Cards mirror the real card shape (w-28, aspect-square thumb,
 * two truncated text lines) so the transition feels like content
 * filling in, not a layout swap.
 */
function SearchResultsSkeleton() {
  return (
    <div className="space-y-4 px-2 pt-2 pb-3">
      <div>
        <Skeleton className="mx-2 mb-1.5 h-2.5 w-14" />
        <div className="flex gap-2 px-2 pb-1">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex w-28 shrink-0 flex-col gap-1.5">
              <Skeleton className="aspect-square w-full rounded-lg" />
              <Skeleton className="h-2.5 w-20 mx-0.5" />
              <Skeleton className="h-2 w-14 mx-0.5" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function resolveCatalogImage(path: string): string {
  if (path.startsWith("http")) return path;
  return `https://res.cloudinary.com/all3dp/image/upload/w_200,q_auto,f_auto/${path}`;
}
