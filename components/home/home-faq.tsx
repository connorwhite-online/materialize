import { HOME_FAQ } from "@/lib/seo/home-faq";
import { ChevronDown } from "@/components/icons/chevron-down";

/**
 * Visible FAQ for the anon home page, backing the `FAQPage` JSON-LD
 * emitted alongside it.
 *
 * Native `<details>` / `<summary>` so the answers stay in the HTML
 * (Google requires every marked-up answer to be present on the page)
 * while the closed state only shows the question. No client JS — the
 * disclosure is progressive and works with JS disabled.
 *
 * Copy lives in `lib/seo/home-faq.ts` — do not inline it here, or the
 * markup and the visible text will drift apart.
 */
export function HomeFaq() {
  return (
    <section
      aria-labelledby="faq"
      className="mt-16 border-t border-border pt-12 sm:mt-24 sm:pt-16"
    >
      <h2 id="faq" className="text-2xl font-bold leading-tight sm:text-3xl">
        Questions?
      </h2>
      <div className="mt-8 flex flex-col gap-3">
        {HOME_FAQ.map((item) => (
          <details
            key={item.question}
            className="group rounded-xl bg-card px-4 py-3.5 shadow-surface ring-1 ring-foreground/10"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-semibold leading-snug outline-none marker:content-none [&::-webkit-details-marker]:hidden focus-visible:ring-2 focus-visible:ring-ring/50 rounded-sm">
              <span>{item.question}</span>
              <ChevronDown
                size={16}
                className="shrink-0 text-muted-foreground transition-transform duration-200 ease-out group-open:rotate-180"
              />
            </summary>
            <p className="mt-2 pr-7 text-sm leading-relaxed text-muted-foreground">
              {item.answer}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}
