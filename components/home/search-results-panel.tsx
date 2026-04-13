"use client";

import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  SearchHitFile,
  SearchHitMaterial,
  SearchHitUser,
  SearchResponse,
} from "@/app/api/search/route";

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
  if (loading && !results) {
    return <SearchResultsSkeleton />;
  }

  if (!results) return null;

  const anyResults =
    results.files.length > 0 ||
    results.users.length > 0 ||
    results.materials.length > 0;

  if (!anyResults) {
    return (
      <div className="px-3 pt-2 pb-3">
        <p className="text-xs text-muted-foreground">
          No results for &ldquo;{query}&rdquo;
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 px-2 pt-2 pb-3">
      {results.files.length > 0 && (
        <Section title="Files">
          {results.files.map((hit) => (
            <FileCard key={hit.id} hit={hit} onNavigate={onNavigate} />
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

function FileCard({
  hit,
  onNavigate,
}: {
  hit: SearchHitFile;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={`/files/${hit.slug}`}
      onClick={onNavigate}
      className="group flex w-28 shrink-0 flex-col gap-1.5"
    >
      <div className="aspect-square overflow-hidden rounded-lg border border-border bg-muted/60">
        {hit.thumbnailUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={hit.thumbnailUrl}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
          />
        )}
      </div>
      <div className="min-w-0 px-0.5">
        <p className="truncate text-xs font-medium group-hover:text-primary">
          {hit.name}
        </p>
        <p className="truncate text-[10px] text-muted-foreground">
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
      <div className="aspect-square overflow-hidden rounded-lg border border-border bg-muted/60">
        {hit.featuredImage && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={resolveCatalogImage(hit.featuredImage)}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
          />
        )}
      </div>
      <div className="min-w-0 px-0.5">
        <p className="truncate text-xs font-medium group-hover:text-primary">
          {hit.name}
        </p>
        <p className="truncate text-[10px] text-muted-foreground">
          {hit.groupName}
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
      href={`/u/${hit.username}`}
      onClick={onNavigate}
      className="group flex w-28 shrink-0 flex-col items-center gap-1.5"
    >
      <div className="h-16 w-16 overflow-hidden rounded-full border border-border bg-muted/60">
        {hit.avatarUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={hit.avatarUrl}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
          />
        )}
      </div>
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

function SearchResultsSkeleton() {
  return (
    <div className="space-y-4 px-2 pt-2 pb-3">
      {["Files", "Materials", "Creators"].map((title) => (
        <div key={title}>
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
      ))}
    </div>
  );
}

function resolveCatalogImage(path: string): string {
  if (path.startsWith("http")) return path;
  return `https://res.cloudinary.com/all3dp/image/upload/w_200,q_auto,f_auto/${path}`;
}
