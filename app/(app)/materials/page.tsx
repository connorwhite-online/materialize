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

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Materialize materials catalog",
    numberOfItems: totalMaterials,
    itemListElement: catalog.groups.flatMap((g) =>
      g.materials.map((m, idx) => ({
        "@type": "ListItem",
        position: idx + 1,
        url: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/materials/${m.slug}`,
        name: m.name,
      }))
    ),
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
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
