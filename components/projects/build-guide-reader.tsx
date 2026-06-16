import { splitGuideIntoChapters } from "@/lib/build-guide/chapters";
import { MarkdownProse } from "@/components/ui/markdown-prose";
import { BuildGuideChapters } from "./build-guide-chapters";

// Step photos in a guide want to read larger than the compact cap used
// for descriptions and comment images.
const GUIDE_IMAGE_MAX_HEIGHT = "max-h-[36rem]";

function Prose({ children }: { children: string }) {
  return (
    <MarkdownProse
      imageMaxHeightClass={GUIDE_IMAGE_MAX_HEIGHT}
      allowHtml
      richMedia
    >
      {children}
    </MarkdownProse>
  );
}

/**
 * Read-only build-guide renderer. Splits the stored document on its H2
 * headings into a table of contents + collapsible chapters (so long
 * guides stay scannable), and enables rich media — galleries render as a
 * click-to-expand carousel and images open the full-screen viewer.
 *
 * Legacy markdown guides (no `<h2>` tags) fall through as a single block.
 */
export function BuildGuideReader({ html }: { html: string }) {
  const { intro, chapters } = splitGuideIntoChapters(html);

  if (chapters.length === 0) {
    return <Prose>{intro || html}</Prose>;
  }

  return (
    <BuildGuideChapters
      intro={intro ? <Prose>{intro}</Prose> : null}
      chapters={chapters.map((c) => ({
        id: c.id,
        title: c.title,
        content: <Prose>{c.bodyHtml}</Prose>,
      }))}
    />
  );
}
