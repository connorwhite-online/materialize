import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders markdown source as styled prose. Used for file + project
 * descriptions where the creator may have authored documentation
 * (links, lists, code blocks) rather than a single paragraph.
 *
 * Safety — react-markdown does NOT pass raw HTML through by default,
 * so untrusted input can't inject `<script>` etc. Images are
 * intentionally not rendered (the photo gallery is the right surface
 * for visuals); see the `img` override below.
 */
export function MarkdownProse({ children }: { children: string }) {
  return (
    <div className="text-sm leading-relaxed text-muted-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => (
            <p className="my-3 first:mt-0 last:mb-0 whitespace-pre-wrap break-words">
              {children}
            </p>
          ),
          h1: ({ children }) => (
            <h2 className="mt-5 mb-2 text-base font-semibold text-foreground">
              {children}
            </h2>
          ),
          h2: ({ children }) => (
            <h3 className="mt-5 mb-2 text-sm font-semibold text-foreground">
              {children}
            </h3>
          ),
          h3: ({ children }) => (
            <h4 className="mt-4 mb-2 text-sm font-medium text-foreground">
              {children}
            </h4>
          ),
          h4: ({ children }) => (
            <h5 className="mt-3 mb-1.5 text-sm font-medium text-foreground">
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
          // Images are not rendered — the photo gallery is the right
          // surface for visuals, and inlining unknown remote images
          // adds an ad-hoc DMCA + privacy attack surface.
          img: () => null,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
