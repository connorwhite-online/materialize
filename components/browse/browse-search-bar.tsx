import { Button } from "@/components/ui/button";

interface BrowseSearchBarProps {
  defaultValue?: string;
}

/**
 * Static search bar for /files. Mirrors the surface treatment of the
 * anon home bottom bar (rounded-3xl, muted backdrop, depth-sunken)
 * but lives inline at the top of the layout — no fixed positioning,
 * no expand-on-focus, no live results panel. The browse page itself
 * server-renders the results below this bar from the `?q=` param,
 * so the bar's only job is to submit the form.
 */
export function BrowseSearchBar({ defaultValue }: BrowseSearchBarProps) {
  return (
    <form
      method="GET"
      action="/files"
      className="w-full max-w-2xl rounded-3xl border border-input bg-muted/70 backdrop-blur-xl dark:bg-input/40 depth-sunken p-1"
    >
      <div className="flex h-[38px] items-center gap-1 px-1">
        <input
          type="search"
          name="q"
          defaultValue={defaultValue}
          aria-label="Search files, creators, and projects"
          placeholder="Search files, creators, projects..."
          className="flex-1 bg-transparent px-3 py-1 text-base md:text-sm placeholder:text-muted-foreground/60 focus:outline-none"
        />
        <Button type="submit" size="sm">
          Search
        </Button>
      </div>
    </form>
  );
}
