/**
 * First tab stop: lets keyboard and switch users jump past the nav
 * straight to the page. Invisible until focused. Targets the
 * `#main-content` landmark, which must carry `tabIndex={-1}` so focus
 * actually lands there.
 */
export function SkipLink() {
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:rounded-full focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-lg focus:ring-2 focus:ring-ring"
    >
      Skip to content
    </a>
  );
}
