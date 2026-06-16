import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { richHtmlSchema } from "@/lib/sanitize/html-schema";
import { cn } from "@/lib/utils";

// Map a pasted `align` attribute (preserved through sanitize for
// imported HTML) to a text-align utility. The custom element renderers
// only receive `children`, so we read the alignment off the hast node's
// properties and apply it as a class — otherwise `<h1 align="center">`
// survives sanitization but renders flush-left.
function nodeAlign(node: unknown): string {
  const align = (node as { properties?: Record<string, unknown> } | undefined)
    ?.properties?.align;
  if (align === "center") return "text-center";
  if (align === "right" || align === "end") return "text-right";
  if (align === "justify") return "text-justify";
  return "";
}

// Sanitize schema for the `allowHtml` path lives in lib/sanitize so the
// write-time sanitizer (sanitizeRichHtml) shares the exact same allowlist.
const htmlSchema = richHtmlSchema;

/**
 * Renders markdown source as styled prose. Used for file + project
 * descriptions and discussion comments — anywhere a user-authored
 * body may want bold, italic, links, lists, code, or inline images.
 *
 * Safety — by default react-markdown does NOT pass raw HTML through,
 * so untrusted input (descriptions, comments) can't inject `<script>`
 * etc. The opt-in `allowHtml` flag turns on `rehype-raw` so embedded
 * HTML renders, paired with `rehype-sanitize` so the markup is still
 * scrubbed to a safe subset. Only owner-authored surfaces (the build
 * guide) should pass it. Inline images are rendered (post-attached
 * comment images use markdown image syntax pointing at our own
 * /api/thumbnails URLs); the image renderer caps at a sensible
 * max-height so a tall photo doesn't blow out the column.
 */
export function MarkdownProse({
  children,
  imageMaxHeightClass = "max-h-80",
  allowHtml = false,
}: {
  children: string;
  /**
   * Tailwind max-height class applied to inline images. Defaults to a
   * compact cap for descriptions/comments; the build guide passes a
   * taller value so step photos read at a useful size.
   */
  imageMaxHeightClass?: string;
  /**
   * Render embedded raw HTML (sanitized). Off for untrusted surfaces;
   * the build guide opts in so authors can paste formatted HTML.
   */
  allowHtml?: boolean;
}) {
  return (
    <div className="text-sm leading-relaxed text-muted-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={
          allowHtml ? [rehypeRaw, [rehypeSanitize, htmlSchema]] : []
        }
        components={{
          p: ({ children, node }) => (
            <p
              className={cn(
                "my-3 first:mt-0 last:mb-0 whitespace-pre-wrap break-words",
                nodeAlign(node)
              )}
            >
              {children}
            </p>
          ),
          h1: ({ children, node }) => (
            <h2
              className={cn(
                "mt-5 mb-2 text-base font-semibold text-foreground",
                nodeAlign(node)
              )}
            >
              {children}
            </h2>
          ),
          h2: ({ children, node }) => (
            <h3
              className={cn(
                "mt-5 mb-2 text-sm font-semibold text-foreground",
                nodeAlign(node)
              )}
            >
              {children}
            </h3>
          ),
          h3: ({ children, node }) => (
            <h4
              className={cn(
                "mt-4 mb-2 text-sm font-medium text-foreground",
                nodeAlign(node)
              )}
            >
              {children}
            </h4>
          ),
          h4: ({ children, node }) => (
            <h5
              className={cn(
                "mt-3 mb-1.5 text-sm font-medium text-foreground",
                nodeAlign(node)
              )}
            >
              {children}
            </h5>
          ),
          ul: ({ children }) => (
            <ul className="my-3 list-disc space-y-1 pl-5">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="my-3 list-decimal space-y-1 pl-5">{children}</ol>
          ),
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className="font-medium text-foreground underline-offset-2 hover:underline"
            >
              {children}
            </a>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-foreground">
              {children}
            </strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
          code: ({ children }) => (
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground">
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre className="my-3 overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs leading-relaxed text-foreground">
              {children}
            </pre>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-3 border-l-2 border-border pl-3 italic">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-4 border-border" />,
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-border bg-muted px-2 py-1 text-left font-semibold text-foreground">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-border px-2 py-1">{children}</td>
          ),
          img: ({ src, alt }) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={typeof src === "string" ? src : undefined}
              alt={alt || ""}
              loading="lazy"
              className={`my-3 block ${imageMaxHeightClass} max-w-full rounded-xl border border-border object-contain`}
            />
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
