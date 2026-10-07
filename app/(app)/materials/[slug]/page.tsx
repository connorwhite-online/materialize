import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "@/components/icons/chevron-left";
import { Print } from "@/components/icons/print";
import {
  findMaterialBySlug,
  type CatalogMaterial,
} from "@/lib/craftcloud/catalog";
import { safeJsonLdScript } from "@/lib/seo/json-ld";

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
}

export async function generateMetadata(props: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await props.params;
  const hit = await findMaterialBySlug(slug);
  if (!hit) {
    return { title: "Not found", robots: { index: false, follow: false } };
  }
  const { material, group } = hit;

  const description = truncate(
    material.descriptionShort?.trim() ||
      material.description?.trim() ||
      `${material.name} — a ${group.name} 3D printing material on Materialize.`,
    155
  );
  const url = `/materials/${material.slug}`;

  // og:image / twitter:image are emitted by opengraph-image.tsx in
  // this segment — leave them off here to avoid duplicate tags.
  return {
    title: `${material.name} (${group.name})`,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      title: material.name,
      description,
      url,
    },
    twitter: {
      card: "summary_large_image",
      title: material.name,
      description,
    },
  };
}

export default async function MaterialDetailPage(props: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await props.params;
  const hit = await findMaterialBySlug(slug);
  if (!hit) notFound();
  const { material, group } = hit;

  const tags = material.tags ?? [];
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://materialize.cc";
  const printUrl = `${appUrl}/print?material=${material.id}`;
  const detailUrl = `${appUrl}/materials/${material.slug}`;

  // JSON-LD for agent crawlers and search engines. Includes an Offer
  // pointing at the print page so agent shopping flows can find a
  // checkout entry, even though we don't surface a fixed price here
  // (every material × geometry × vendor combo is custom-priced at
  // quote time). When Stage 3 of the agent-payments roadmap lands,
  // this will gain priceSpecification: PriceRange data computed from
  // a benchmark geometry; for now availability + URL are the
  // honest signals we can give.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: material.name,
    description: material.description ?? material.descriptionShort ?? undefined,
    image: material.featuredImage ?? undefined,
    url: detailUrl,
    sku: material.id,
    brand: { "@type": "Brand", name: "Materialize" },
    category: group.name,
    offers: {
      "@type": "Offer",
      url: printUrl,
      availability: "https://schema.org/InStock",
      priceCurrency: "USD",
      itemCondition: "https://schema.org/NewCondition",
      seller: { "@type": "Organization", name: "Materialize" },
    },
    additionalProperty: [
      hasNumber(material.tensileStrengthMax)
        ? {
            "@type": "PropertyValue",
            name: "Tensile strength (max)",
            value: material.tensileStrengthMax,
            unitText: "MPa",
          }
        : null,
      hasNumber(material.density)
        ? {
            "@type": "PropertyValue",
            name: "Density",
            value: material.density,
            unitText: "g/cm³",
          }
        : null,
      hasNumber(material.heatDeflectionTemp66PSIMax)
        ? {
            "@type": "PropertyValue",
            name: "Heat deflection (66 PSI)",
            value: material.heatDeflectionTemp66PSIMax,
            unitText: "°C",
          }
        : null,
    ].filter(Boolean),
  };

  const hasMechanical =
    hasNumber(material.tensileStrengthMax) ||
    hasNumber(material.tensileModulusMax) ||
    hasNumber(material.flexuralStrengthMax) ||
    hasNumber(material.density);
  const hasThermal =
    hasNumber(material.heatDeflectionTemp66PSIMax) ||
    hasNumber(material.heatDeflectionTemp264PSIMax);

  return (
    <div className="mz-enter mx-auto flex w-full max-w-6xl flex-col gap-12 px-4 pt-6 pb-16 sm:pt-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdScript(jsonLd) }}
      />
      {/* Hero: the material left, the decision right (one CTA). */}
      <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:gap-12">
        <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-muted md:aspect-square">
          {material.featuredImage && (
            <Image
              src={resolveCatalogImage(material.featuredImage, 900)}
              alt={material.name}
              fill
              priority
              sizes="(max-width: 768px) 100vw, 50vw"
              className="object-cover"
            />
          )}
        </div>

        <div className="flex flex-col items-start gap-5 md:py-2">
          <div className="flex flex-col items-start gap-2">
            <Link
              href="/materials"
              className="-ml-2 inline-flex h-7 items-center gap-1 rounded-lg pr-2 pl-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronLeft size={14} />
              {group.name}
            </Link>
            <h1 className="text-2xl leading-7 font-semibold text-balance sm:text-[28px] sm:leading-8">
              {material.name}
            </h1>
            {tags.length > 0 && (
              <ul className="mt-1 flex flex-wrap gap-1.5" aria-label="Properties">
                {tags.slice(0, 5).map((t) => (
                  <li key={t.id}>
                    <Badge variant="secondary">{t.name}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {material.description && (
            <p className="max-w-prose text-sm leading-6 text-pretty text-muted-foreground">
              {material.description}
            </p>
          )}

          {/* This page's one job is to start a print: one primary, lg,
              natural width, with the next step spelled out under it. */}
          <div className="flex flex-col items-start gap-2">
            <Button
              size="lg"
              render={<Link href={`/print?material=${material.id}`} />}
            >
              <Print size={16} />
              Print with {material.name}
            </Button>
            <p className="text-[13px] leading-[18px] text-muted-foreground">
              Upload a model next for instant quotes from print shops.
            </p>
          </div>
        </div>
      </div>

      {/* Specs: unboxed sections of label/value rows. */}
      <div className="grid grid-cols-1 gap-x-12 gap-y-10 md:grid-cols-2 lg:grid-cols-3">
        {hasMechanical && (
          <SpecSection title="Mechanical">
            <RangeRow
              label="Tensile strength"
              min={material.tensileStrengthMin}
              max={material.tensileStrengthMax}
              unit="MPa"
            />
            <RangeRow
              label="Tensile modulus"
              min={material.tensileModulusMin}
              max={material.tensileModulusMax}
              unit="MPa"
            />
            <RangeRow
              label="Elongation"
              min={material.tensileElongationMin}
              max={material.tensileElongationMax}
              unit="%"
            />
            <RangeRow
              label="Flexural strength"
              min={material.flexuralStrengthMin}
              max={material.flexuralStrengthMax}
              unit="MPa"
            />
            <RangeRow
              label="Flexural modulus"
              min={material.flexuralModulusMin}
              max={material.flexuralModulusMax}
              unit="MPa"
            />
            {hasNumber(material.density) && (
              <Row label="Density" value={`${formatNumber(material.density)} g/cm³`} />
            )}
          </SpecSection>
        )}

        {hasThermal && (
          <SpecSection title="Thermal">
            <RangeRow
              label="Heat deflection, 66 PSI"
              min={material.heatDeflectionTemp66PSIMin}
              max={material.heatDeflectionTemp66PSIMax}
              unit="°C"
            />
            <RangeRow
              label="Heat deflection, 264 PSI"
              min={material.heatDeflectionTemp264PSIMin}
              max={material.heatDeflectionTemp264PSIMax}
              unit="°C"
            />
          </SpecSection>
        )}

        <SpecSection title="Printing">
          {material.maximumPrintingDimensions && (
            <Row
              label="Max build volume"
              value={`${material.maximumPrintingDimensions
                .map((n) => formatNumber(n))
                .join(" × ")} mm`}
            />
          )}
          {hasNumber(material.defaultLayerHeight) && (
            <Row label="Layer height" value={`${material.defaultLayerHeight} mm`} />
          )}
          {hasNumber(material.defaultInfill) && (
            <Row label="Infill" value={`${material.defaultInfill}%`} />
          )}
          {hasNumber(material.accuracy) && (
            <Row label="Accuracy" value={`± ${material.accuracy} mm`} />
          )}
          {hasNumber(material.embossingMin) && (
            <Row label="Min embossing" value={`${material.embossingMin} mm`} />
          )}
          {hasNumber(material.engravingMin) && (
            <Row label="Min engraving" value={`${material.engravingMin} mm`} />
          )}
          {material.warpingRisk && (
            <Row label="Warping risk" value={humanize(material.warpingRisk)} />
          )}
          {typeof material.interlockingParts === "boolean" && (
            <Row
              label="Interlocking parts"
              value={material.interlockingParts ? "Supported" : "Not supported"}
            />
          )}
        </SpecSection>
      </div>

      {material.finishGroups.length > 0 && (
        <section className="flex flex-col gap-4">
          <div>
            <h2 className="text-base leading-6 font-semibold">Finishes</h2>
            <p className="mt-0.5 text-[13px] leading-[18px] text-muted-foreground">
              You pick a finish and color when you order.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:gap-x-4 md:grid-cols-3 lg:grid-cols-4">
            {material.finishGroups.map((fg) => {
              const colorCount = new Set(
                fg.materialConfigs.map((c) => c.color)
              ).size;
              return (
                <div key={fg.id} className="min-w-0">
                  <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-muted ring-1 ring-border/60 ring-inset">
                    {fg.featuredImage && (
                      <Image
                        src={resolveCatalogImage(fg.featuredImage, 480)}
                        alt={fg.name}
                        fill
                        sizes="(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
                        className="object-cover"
                      />
                    )}
                  </div>
                  <div className="px-0.5 pt-2.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <h3 className="truncate text-sm leading-5 font-medium">
                        {fg.name}
                      </h3>
                      {colorCount > 0 && (
                        <span className="shrink-0 text-xs text-subtle-foreground tabular-nums">
                          {colorCount} {colorCount === 1 ? "color" : "colors"}
                        </span>
                      )}
                    </div>
                    {fg.descriptionShort && (
                      <p className="mt-0.5 line-clamp-2 text-[13px] leading-[18px] text-muted-foreground">
                        {fg.descriptionShort}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

// --- helpers ---

function hasNumber(v: number | null | undefined): v is number {
  return typeof v === "number" && !Number.isNaN(v);
}

/** CraftCloud enums arrive as e.g. "over_140_mm": make them read as words. */
function humanize(s: string) {
  const words = s.replace(/_/g, " ").trim();
  return words.length === 0 ? words : words[0].toUpperCase() + words.slice(1);
}

/** 180000 → "180,000" so large moduli are readable at a glance. */
function formatNumber(n: number) {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function SpecSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-base leading-6 font-semibold">{title}</h2>
      <dl className="flex flex-col border-t border-border text-sm">{children}</dl>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-2.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right tabular-nums">{value}</dd>
    </div>
  );
}

function RangeRow({
  label,
  min,
  max,
  unit,
}: {
  label: string;
  min: CatalogMaterial["tensileStrengthMin"];
  max: CatalogMaterial["tensileStrengthMax"];
  unit: string;
}) {
  const hasMin = hasNumber(min);
  const hasMax = hasNumber(max);
  if (!hasMin && !hasMax) return null;
  const display = hasMin && hasMax && min !== max
    ? `${formatNumber(min)}–${formatNumber(max)} ${unit}`
    : `${formatNumber((hasMax ? max : min) as number)} ${unit}`;
  return <Row label={label} value={display} />;
}

function resolveCatalogImage(path: string, width: number): string {
  if (path.startsWith("http")) return path;
  return `https://res.cloudinary.com/all3dp/image/upload/w_${width},q_auto,f_auto/${path}`;
}
