import { Github } from "@/components/icons/github";
import { ChevronRight } from "@/components/icons/chevron-right";

/**
 * Derive a friendly "host/owner/repo" label from a repo URL, dropping
 * the protocol, a leading www., a trailing slash, and a trailing .git.
 * Falls back to the raw string for anything that doesn't parse.
 */
function repoLabel(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const path = u.pathname.replace(/\.git$/, "").replace(/\/$/, "");
    return `${host}${path}`;
  } catch {
    return url;
  }
}

/**
 * Compact card linking out to a project's source repository. Sits
 * below the description and above the content tabs on the project
 * page. The GitHub mark lives in a tinted square so the card reads as
 * a single tappable affordance on mobile.
 */
export function SourceCodeCard({ repoUrl }: { repoUrl: string }) {
  return (
    <a
      href={repoUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-center gap-3 rounded-xl border border-border bg-card p-3 ring-1 ring-foreground/10 transition-colors hover:border-foreground/20 hover:bg-muted/40"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-foreground text-background">
        <Github size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">Source code</span>
        <span className="block truncate text-xs text-muted-foreground">
          {repoLabel(repoUrl)}
        </span>
      </span>
      <ChevronRight
        size={16}
        className="shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
      />
    </a>
  );
}
