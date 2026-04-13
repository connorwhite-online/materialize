import { notFound } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ChevronRight } from "@/components/icons/chevron-right";
import {
  findMaterialBySlug,
  type CatalogMaterial,
} from "@/lib/craftcloud/catalog";

export default async function MaterialDetailPage(props: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await props.params;
  const hit = await findMaterialBySlug(slug);
  if (!hit) notFound();
  const { material, group } = hit;

  const tags = material.tags ?? [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      {/* Hero */}
      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        <div className="relative aspect-square overflow-hidden rounded-xl border border-border bg-muted/30">
          {material.featuredImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={resolveCatalogImage(material.featuredImage, 900)}
              alt={material.name}
              className="h-full w-full object-cover"
            />
          )}
        </div>

        <div>
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <Badge variant="outline">{group.name}</Badge>
            {tags.slice(0, 4).map((t) => (
              <Badge key={t.id} variant="secondary" className="text-[10px]">
                {t.name}
              </Badge>
            ))}
          </div>

          <h1 className="text-3xl font-bold">{material.name}</h1>
          {material.description && (
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              {material.description}
            </p>
          )}

          <div className="mt-6">
            <Button
              size="lg"
              render={<Link href={`/print?material=${material.id}`} />}
            >
              Print with {material.name}
            </Button>
          </div>
        </div>
      </div>

      <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Mechanical properties */}
        {(hasNumber(material.tensileStrengthMax) ||
          hasNumber(material.tensileModulusMax) ||
          hasNumber(material.flexuralStrengthMax) ||
          hasNumber(material.density)) && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Mechanical Properties</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
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
                <Row label="Density" value={`${material.density} g/cm³`} />
              )}
            </CardContent>
          </Card>
        )}

        {/* Thermal */}
        {(hasNumber(material.heatDeflectionTemp66PSIMax) ||
          hasNumber(material.heatDeflectionTemp264PSIMax)) && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Thermal</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <RangeRow
                label="Heat deflection at 66 PSI"
                min={material.heatDeflectionTemp66PSIMin}
                max={material.heatDeflectionTemp66PSIMax}
                unit="°C"
              />
              <RangeRow
                label="Heat deflection at 264 PSI"
                min={material.heatDeflectionTemp264PSIMin}
                max={material.heatDeflectionTemp264PSIMax}
                unit="°C"
              />
            </CardContent>
          </Card>
        )}

        {/* Print constraints */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Print Constraints</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {material.maximumPrintingDimensions && (
              <div>
                <p className="text-xs text-muted-foreground">
                  Maximum build volume
                </p>
                <p className="mt-0.5 font-mono">
                  {material.maximumPrintingDimensions.x} ×{" "}
                  {material.maximumPrintingDimensions.y} ×{" "}
                  {material.maximumPrintingDimensions.z} mm
                </p>
              </div>
            )}
            {hasNumber(material.defaultLayerHeight) && (
              <Row
                label="Default layer height"
                value={`${material.defaultLayerHeight} mm`}
              />
            )}
            {hasNumber(material.defaultInfill) && (
              <Row label="Default infill" value={`${material.defaultInfill}%`} />
            )}
            {hasNumber(material.embossingMin) && (
              <Row
                label="Min embossing"
                value={`${material.embossingMin} mm`}
              />
            )}
            {hasNumber(material.engravingMin) && (
              <Row
                label="Min engraving"
                value={`${material.engravingMin} mm`}
              />
            )}
            {hasNumber(material.accuracy) && (
              <Row label="Accuracy" value={`± ${material.accuracy} mm`} />
            )}
            {material.warpingRisk && (
              <Row label="Warping risk" value={capitalize(material.warpingRisk)} />
            )}
            {typeof material.interlockingParts === "boolean" && (
              <Row
                label="Interlocking parts"
                value={material.interlockingParts ? "Supported" : "Not supported"}
              />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Available finishes */}
      {material.finishGroups.length > 0 && (
        <div className="mt-12">
          <h2 className="text-lg font-semibold">Available finishes</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Each finish can be combined with the available colors at checkout.
          </p>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {material.finishGroups.map((fg) => {
              const colorCount = new Set(
                fg.materialConfigs.map((c) => c.color)
              ).size;
              return (
                <Card key={fg.id} className="gap-0 py-0 overflow-hidden">
                  {fg.featuredImage && (
                    <div className="relative aspect-[4/3] w-full bg-muted/40">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={resolveCatalogImage(fg.featuredImage, 480)}
                        alt={fg.name}
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    </div>
                  )}
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-medium">{fg.name}</h3>
                      <span className="text-[11px] text-muted-foreground">
                        {colorCount}{" "}
                        {colorCount === 1 ? "color" : "colors"}
                      </span>
                    </div>
                    {fg.descriptionShort && (
                      <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">
                        {fg.descriptionShort}
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-10">
        <Link
          href="/materials"
          className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          <ChevronRight size={14} className="rotate-180" />
          All materials
        </Link>
      </div>
    </div>
  );
}

// --- helpers ---

function hasNumber(v: number | null | undefined): v is number {
  return typeof v === "number" && !Number.isNaN(v);
}

function capitalize(s: string) {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-xs">{value}</span>
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
    ? `${min}–${max} ${unit}`
    : `${hasMax ? max : min} ${unit}`;
  return <Row label={label} value={display} />;
}

function resolveCatalogImage(path: string, width: number): string {
  if (path.startsWith("http")) return path;
  return `https://res.cloudinary.com/all3dp/image/upload/w_${width},q_auto,f_auto/${path}`;
}
