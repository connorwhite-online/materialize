import { HOME_FAQ } from "@/lib/seo/home-faq";
import { FaqCard } from "@/components/home/faq-card";
import { cn } from "@/lib/utils";

/**
 * Visible FAQ for the anon home page, backing the `FAQPage` JSON-LD
 * emitted alongside it.
 *
 * Each item is a springy accordion card. The answer stays in the DOM
 * (height 0 when closed) so it still matches `acceptedAnswer.text`.
 *
 * Copy lives in `lib/seo/home-faq.ts` — do not inline it here, or the
 * markup and the visible text will drift apart.
 */
export function HomeFaq({
  className,
  title = "3D printing on Materialize — common questions",
}: { className?: string; title?: string } = {}) {
  return (
    <section
      aria-labelledby="faq"
      className={cn(
        "mt-16 border-t border-border pt-12 sm:mt-24 sm:pt-16",
        className,
      )}
    >
      <h2 id="faq" className="text-lg font-semibold tracking-tight sm:text-xl">
        {title}
      </h2>
      {/* One column. In a two-column grid each row stretches to its
          tallest card, so opening one answer ballooned its neighbour. */}
      <div className="mt-6 grid gap-3">
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
