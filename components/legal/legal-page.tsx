import { MarkdownProse } from "@/components/ui/markdown-prose";
import { LEGAL_LAST_UPDATED } from "@/lib/legal/content";

/** Shared shell for /privacy, /terms and /support. */
export function LegalPage({
  title,
  markdown,
  showUpdated = true,
}: {
  title: string;
  markdown: string;
  showUpdated?: boolean;
}) {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">
        {title}
      </h1>
      {showUpdated && (
        <p className="mt-2 text-sm text-muted-foreground">
          Last updated {LEGAL_LAST_UPDATED}
        </p>
      )}
      <div className="mt-8">
        <MarkdownProse>{markdown}</MarkdownProse>
      </div>
    </main>
  );
}
