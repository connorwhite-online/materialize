"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { SearchIcon } from "@/components/icons/oai";

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
 * Search field for /files. A plain GET form: the page server-renders
 * results from `?q=`, so the field's only job is to submit. Enter (or
 * the keyboard's Search key, via `enterKeyHint`) submits; there is no
 * separate Search button, which read as a second primary action beside
 * the header's Print button. The clear button resets to the unfiltered
 * grid but keeps the category, the same way the chips keep the query.
 */
export function BrowseSearchBar({ defaultValue = "", category }: BrowseSearchBarProps) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const handleClear = () => {
    setValue("");
    inputRef.current?.focus();
    router.push(category ? `/files?category=${encodeURIComponent(category)}` : "/files");
  };

  return (
    <form method="GET" action="/files" role="search" className="w-full max-w-xl">
      {category ? (
        <input type="hidden" name="category" value={category} />
      ) : null}
      <div className="relative">
        <SearchIcon
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-subtle-foreground"
        />
        <input
          ref={inputRef}
          type="search"
          name="q"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          enterKeyHint="search"
          autoComplete="off"
          aria-label="Search files, creators, and projects"
          placeholder="Search files, creators, projects"
          className="h-10 w-full min-w-0 rounded-full border border-input bg-background pr-10 pl-10 field-text outline-none transition-[border-color,box-shadow] duration-150 ease-out placeholder:text-subtle-foreground hover:border-foreground/25 focus-visible:border-ring focus-visible:shadow-input-focus md:text-sm [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
        />
        {value && (
          <button
            type="button"
            onClick={handleClear}
            aria-label="Clear search"
            className="absolute top-1/2 right-2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-subtle-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <CircleXIcon className="size-4" />
          </button>
        )}
      </div>
    </form>
  );
}
