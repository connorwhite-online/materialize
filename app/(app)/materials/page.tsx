import { getCraftCloudCatalog } from "@/lib/craftcloud/catalog";
import { CatalogBrowser } from "@/components/materials/catalog-browser";

export const metadata = {
  title: "Materials | Materialize",
  description:
    "Browse 3D printing materials — plastics, metals, resins, composites, and more.",
};

export default async function MaterialsPage() {
  const catalog = await getCraftCloudCatalog();
  const totalMaterials = catalog.groups.reduce(
    (sum, g) => sum + g.materials.length,
    0
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Materials</h1>
        <p className="mt-1 text-muted-foreground">
          Browse {totalMaterials} 3D printing materials across{" "}
          {catalog.groups.length} families. Each with unique properties for
          your project.
        </p>
      </div>

      <CatalogBrowser groups={catalog.groups} />
    </div>
  );
}
