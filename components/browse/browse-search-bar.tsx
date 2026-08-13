"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

interface BrowseSearchBarProps {
  defaultValue?: string;
  /**
   * Active category slug. Carried through as a hidden field so
   * submitting a search keeps the category filter applied instead of
   * silently dropping it (the form is a plain GET to /files).
   */
  category?: string;
}

function CircleXIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12ZM9.70711 8.29289C9.31658 7.90237 8.68342 7.90237 8.29289 8.29289C7.90237 8.68342 7.90237 9.31658 8.29289 9.70711L10.5858 12L8.29289 14.2929C7.90237 14.6834 7.90237 15.3166 8.29289 15.7071C8.68342 16.0976 9.31658 16.0976 9.70711 15.7071L12 13.4142L14.2929 15.7071C14.6834 16.0976 15.3166 16.0976 15.7071 15.7071C16.0976 15.3166 16.0976 14.6834 15.7071 14.2929L13.4142 12L15.7071 9.70711C16.0976 9.31658 16.0976 8.68342 15.7071 8.29289C15.3166 7.90237 14.6834 7.90237 14.2929 8.29289L12 10.5858L9.70711 8.29289Z"
        fill="currentColor"
      />
    </svg>
  );
}

/**
 * Static search bar for /files. Mirrors the surface treatment of the
 * anon home bottom bar (rounded-3xl, muted backdrop, depth-sunken)
 * but lives inline at the top of the layout — no fixed positioning,
 * no expand-on-focus, no live results panel. The browse page itself
 * server-renders the results below this bar from the `?q=` param,
 * so the bar's only job is to submit the form.
 */
export function BrowseSearchBar({ defaultValue = "", category }: BrowseSearchBarProps) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const handleClear = () => {
    setValue("");
    inputRef.current?.focus();
    router.push("/files");
  };


  return (
    <form
      method="GET"
      action="/files"
      className="w-full max-w-2xl rounded-3xl border border-input bg-muted/70 backdrop-blur-xl dark:bg-input/40 depth-sunken p-1 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2"
    >
      {category ? (
        <input type="hidden" name="category" value={category} />
      ) : null}
      <div className="flex h-[38px] items-center gap-1 px-1">
        <input
          ref={inputRef}
          type="search"
          name="q"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label="Search files, creators, and projects"
          placeholder="Search files, creators, projects..."
          className="flex-1 bg-transparent px-3 py-1 field-text md:text-sm placeholder:text-muted-foreground/60 focus:outline-none [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
        />
        {value && (
          <button
            type="button"
            onClick={handleClear}
            aria-label="Clear search"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground/60 transition-colors hover:text-foreground"
          >
            <CircleXIcon className="h-5 w-5" />
          </button>
        )}
        <Button type="submit" size="sm">
          Search
        </Button>
      </div>
    </form>
  );
}
