import { notFound } from "next/navigation";
import Link from "next/link";
import { getMaterialBySlug, MATERIALS } from "@/lib/materials";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { MaterialCardPreview } from "@/components/materials/material-card-preview";

export async function generateStaticParams() {
  return MATERIALS.map((m) => ({ slug: m.slug }));
}

const PROPERTY_LABELS = {
  strength: "Strength",
  flexibility: "Flexibility",
  detail: "Detail",
  heatResistance: "Heat Resistance",
};

export default async function MaterialDetailPage(props: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await props.params;
  const material = getMaterialBySlug(slug);

  if (!material) notFound();

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      {/* Hero */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="relative aspect-square overflow-hidden rounded-xl border border-border">
          <MaterialCardPreview color={material.color} />
        </div>

        <div>
          <div className="flex items-center gap-2 mb-2">
            <Badge variant="outline" className="capitalize">
              {material.category}
            </Badge>
            <Badge variant="secondary">{material.method}</Badge>
            <Badge
              variant="secondary"
              className="capitalize"
            >
              {material.priceRange}
            </Badge>
          </div>

          <h1 className="text-3xl font-bold">{material.name}</h1>
          <p className="mt-3 text-muted-foreground leading-relaxed">
            {material.description}
          </p>

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

      <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Properties */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Properties</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(Object.entries(PROPERTY_LABELS) as [keyof typeof PROPERTY_LABELS, string][]).map(
              ([key, label]) => (
                <div key={key}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-medium">
                      {material.properties[key]}/5
                    </span>
                  </div>
                  <div className="flex gap-1">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div
                        key={i}
                        className={`h-2 flex-1 rounded-full ${
                          i < material.properties[key]
                            ? "bg-foreground/60"
                            : "bg-muted"
                        }`}
                      />
                    ))}
                  </div>
                </div>
              )
            )}
          </CardContent>
        </Card>

        {/* Constraints */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Print Constraints</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm text-muted-foreground mb-1">
                Maximum Build Volume
              </p>
              <p className="font-mono text-sm">
                {material.constraints.maxDimensions.x} ×{" "}
                {material.constraints.maxDimensions.y} ×{" "}
                {material.constraints.maxDimensions.z} mm
              </p>
            </div>

            <Separator />

            <div>
              <p className="text-sm text-muted-foreground mb-1">
                Minimum Wall Thickness
              </p>
              <p className="font-mono text-sm">
                {material.constraints.minWallThickness} mm
              </p>
            </div>

            <Separator />

            <div>
              <p className="text-sm text-muted-foreground mb-1">
                Minimum Detail Size
              </p>
              <p className="font-mono text-sm">
                {material.constraints.minDetail} mm
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-8">
        <Button variant="outline" render={<Link href="/materials" />}>
          &larr; All materials
        </Button>
      </div>
    </div>
  );
}
