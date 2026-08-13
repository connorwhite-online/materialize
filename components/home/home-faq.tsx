import { HOME_FAQ } from "@/lib/seo/home-faq";

/**
 * Visible FAQ for the anon home page, backing the `FAQPage` JSON-LD
 * emitted alongside it.
 *
 * Server component, and deliberately not a collapsible accordion: the
 * answers are rendered as plain, always-visible text so the DOM string
 * matches `acceptedAnswer.text` exactly. It also gives the page a block
 * of substantive, question-shaped prose, which is the format both
 * classic SERP features and AI answer engines quote from.
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
        3D printing on Materialize — common questions
      </h2>
      <dl className="mt-8 grid gap-x-10 gap-y-8 sm:grid-cols-2">
        {HOME_FAQ.map((item) => (
          <div key={item.question} className="space-y-2">
            <dt className="font-semibold leading-snug">{item.question}</dt>
            <dd className="text-sm leading-relaxed text-muted-foreground">
              {item.answer}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
