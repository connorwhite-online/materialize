import { HOME_FAQ } from "@/lib/seo/home-faq";
import { FaqCard } from "@/components/home/faq-card";

/**
 * Visible FAQ for the anon home page, backing the `FAQPage` JSON-LD
 * emitted alongside it.
 *
 * Each item is a springy accordion card. The answer stays in the DOM
 * (height 0 when closed) so it still matches `acceptedAnswer.text`.
 * Copy lives in `lib/seo/home-faq.ts` — do not inline it here, or the
 * markup and the visible text will drift apart.
 */
export function HomeFaq() {
  return (
    <section
      aria-labelledby="faq"
      className="mt-16 border-t border-border pt-12 sm:mt-24 sm:pt-16"
    >
      <h2
        id="faq"
        className="text-lg font-semibold tracking-tight sm:text-xl"
      >
        3D printing on Materialize — common questions
      </h2>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {HOME_FAQ.map((item) => (
          <FaqCard
            key={item.question}
            question={item.question}
            answer={item.answer}
          />
        ))}
      </div>
    </section>
  );
}
