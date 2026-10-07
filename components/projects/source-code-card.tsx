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
 * Row linking out to a project's source repository, in the project
 * page's decision column. Rulebook row anatomy (icon badge, title,
 * meta, chevron) rather than a bordered card: it is a link, not an
 * object.
 */
export function SourceCodeCard({ repoUrl }: { repoUrl: string }) {
  return (
    <a
      href={repoUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="group -mx-3 flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors duration-150 outline-none hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-muted text-foreground">
        <Github size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">Source code</span>
        <span className="block truncate text-[13px] leading-[18px] text-muted-foreground">
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
