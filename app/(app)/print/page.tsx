import { auth } from "@clerk/nextjs/server";
import { getCraftCloudCatalog } from "@/lib/craftcloud/catalog";
import { PrintPageContent } from "@/components/print/print-page-content";
import { loadLibraryTiles } from "@/lib/print/library-tiles";

export default async function PrintPage(props: {
  searchParams: Promise<{ material?: string; expand?: string }>;
}) {
  const searchParams = await props.searchParams;
  const materialId = searchParams.material;
  const initialExpandVendorId = searchParams.expand;
  // The "Print with X" link on /materials/[slug] passes CraftCloud's
  // real material id, so we resolve it against the cached catalog
  // for the headline and then forward the same id downstream for
  // the material-step auto-skip.
  const material = materialId
    ? (await getCraftCloudCatalog()).materialById.get(materialId) ?? null
    : null;

  const { userId } = await auth();
  const tiles = userId ? await loadLibraryTiles(userId) : [];

  const linkSuffix = material ? `?material=${material.id}` : "";

  return (
    <PrintPageContent
      headline={material ? `Print with ${material.name}` : "Print a File"}
      subheadline={
        material
          ? "Pick one of your files or upload a new one — we'll quote it in this material."
          : "Get instant quotes from professional manufacturers worldwide."
      }
      tiles={tiles}
      linkSuffix={linkSuffix}
      preselectMaterialId={material?.id}
      initialExpandVendorId={initialExpandVendorId}
    />
  );
}
