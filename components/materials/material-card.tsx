import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { MaterialMetadata } from "@/lib/materials/preset-library";
import { MaterialCardPreview } from "./material-card-preview";

interface MaterialCardProps {
  material: MaterialMetadata;
}

const PROPERTY_LABELS = {
  strength: "Strength",
  flexibility: "Flexibility",
  detail: "Detail",
  heatResistance: "Heat",
};

export function MaterialCard({ material }: MaterialCardProps) {
  return (
    <Link href={`/materials/${material.slug}`}>
      <Card className="group gap-0 py-0 overflow-hidden transition-colors hover:border-primary/30">
        <div className="h-32 w-full relative overflow-hidden">
          <MaterialCardPreview color={material.color} />
          <Badge
            variant="secondary"
            className="absolute top-2 right-2 text-[10px]"
          >
            {material.method}
          </Badge>
        </div>

        <CardContent className="p-4">
          <h3 className="font-semibold text-sm group-hover:text-primary transition-colors">
            {material.name}
          </h3>
          <p className="text-xs text-muted-foreground mt-1 capitalize">
            {material.category} &middot;{" "}
            <span className="capitalize">{material.priceRange}</span>
          </p>

          {/* Property bars */}
          <div className="mt-3 space-y-1.5">
            {(Object.entries(PROPERTY_LABELS) as [keyof typeof PROPERTY_LABELS, string][]).map(
              ([key, label]) => (
                <div key={key} className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground w-12">
                    {label}
                  </span>
                  <div className="flex-1 flex gap-0.5">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div
                        key={i}
                        className={`h-1.5 flex-1 rounded-full ${
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
          </div>

          {/* Constraints summary */}
          <div className="mt-3 pt-2 border-t border-border text-[10px] text-muted-foreground flex gap-3">
            <span>
              Max {material.constraints.maxDimensions.x}×
              {material.constraints.maxDimensions.y}×
              {material.constraints.maxDimensions.z}mm
            </span>
            <span>Min wall {material.constraints.minWallThickness}mm</span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

