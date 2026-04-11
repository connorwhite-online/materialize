import { Suspense } from "react";
import {
  MATERIALS,
  getMaterialsByCategory,
  getMaterialsByQuickFilter,
  type MaterialCategory,
  type QuickFilter,
} from "@/lib/materials";
import { MaterialCard } from "@/components/materials/material-card";
import { MaterialFilterBar } from "@/components/materials/material-filter-bar";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata = {
  title: "Materials | Materialize",
  description: "Browse 3D printing materials — plastics, metals, resins, and more",
};

export default async function MaterialsPage(props: {
  searchParams: Promise<{ category?: string; filter?: string }>;
}) {
  const searchParams = await props.searchParams;
  const category = searchParams.category as MaterialCategory | undefined;
  const filter = searchParams.filter as QuickFilter | undefined;

  let materials = MATERIALS;
  if (category) {
    materials = getMaterialsByCategory(category);
  } else if (filter) {
    materials = getMaterialsByQuickFilter(filter);
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Materials</h1>
        <p className="mt-1 text-muted-foreground">
          Browse {MATERIALS.length} materials across plastics, metals, resins,
          and more. Each with unique properties for your project.
        </p>
      </div>

      <Suspense fallback={<Skeleton className="h-20 w-full" />}>
        <MaterialFilterBar />
      </Suspense>

      <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {materials.map((material) => (
          <MaterialCard key={material.id} material={material} />
        ))}
      </div>

      {materials.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          No materials match your filters.
        </div>
      )}
    </div>
  );
}
