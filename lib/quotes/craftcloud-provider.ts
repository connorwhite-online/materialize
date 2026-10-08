import "server-only";

import {
  createPriceRequest,
  getPrice,
  CraftCloudApiError,
} from "@/lib/craftcloud/client";
import {
  getCraftCloudCatalog,
  getProviderIndex,
} from "@/lib/craftcloud/catalog";
import {
  QuoteModelNotReadyError,
  QuoteModelRejectedError,
  type EnrichedQuote,
  type QuoteProvider,
  type QuoteShippingOption,
} from "./types";

/**
 * CraftCloud behind the `QuoteProvider` interface. This is the code
 * that used to live inline in the quote routes, moved verbatim: the
 * routes now only do HTTP, validation and access control.
 */
export const craftCloudQuoteProvider: QuoteProvider = {
  async startQuote({ model, currency, countryCode, quantity, materialId }) {
    // Resolve a CraftCloud modelId from either an owned file asset
    // (authed library path) or a direct modelId (anon draft path —
    // the client uploaded straight to CraftCloud, no DB row exists).
    const modelId =
      model.kind === "asset" ? model.asset.craftCloudModelId : model.modelId;
    if (!modelId) throw new QuoteModelNotReadyError();

    // If the caller passed a material-scope hint, expand it to the
    // full set of materialConfigIds for that material and forward
    // them to CraftCloud. This narrows the vendor poll so we only
    // hear from vendors that actually offer configs of this
    // material — much faster first paint when coming from a
    // /materials/[slug] "Print with X" entry.
    let materialConfigIds: string[] | undefined;
    if (materialId) {
      const catalog = await getCraftCloudCatalog();
      const material = catalog.materialById.get(materialId);
      if (material) {
        const ids: string[] = [];
        for (const finishGroup of material.finishGroups ?? []) {
          for (const config of finishGroup.materialConfigs ?? []) {
            ids.push(config.id);
          }
        }
        materialConfigIds = ids.length > 0 ? ids : undefined;
      }
    }

    try {
      return await createPriceRequest({
        currency,
        countryCode,
        models: [{ modelId, quantity }],
        materialConfigIds,
      });
    } catch (error) {
      if (error instanceof CraftCloudApiError && error.isQuoteExpired()) {
        throw new QuoteModelRejectedError({ cause: error });
      }
      throw error;
    }
  },

  async getSnapshot(priceId) {
    const priceResponse = await getPrice(priceId);

    // Enrich every quote with catalog metadata — material, finish
    // group, color, provider name, etc. Quotes whose materialConfigId
    // is not in our cached catalog are dropped (should be very rare
    // and usually indicates the catalog is stale relative to new
    // vendor configs). The cached catalog is shared across all
    // requests via Next's data cache.
    const [catalog, providers] = await Promise.all([
      getCraftCloudCatalog(),
      getProviderIndex(),
    ]);

    let droppedCount = 0;
    const quotes: EnrichedQuote[] = [];
    for (const q of priceResponse.quotes ?? []) {
      const entry = catalog.configById.get(q.materialConfigId);
      if (!entry) {
        droppedCount++;
        continue;
      }
      const provider = providers.get(q.vendorId);
      quotes.push({
        ...q,
        materialId: entry.material.id,
        materialName: entry.material.name,
        materialGroupId: entry.material.materialGroupId,
        materialGroupName: entry.group.name,
        materialImage: entry.material.featuredImage ?? null,
        // 9999 sentinel pushes unranked materials to the bottom of
        // the Popular sort instead of tying with rank-0.
        materialSortIndex: entry.material.sortIndex ?? 9999,
        finishGroupId: entry.finishGroup.id,
        finishGroupName: entry.finishGroup.name,
        finishGroupImage: entry.finishGroup.featuredImage ?? null,
        color: entry.config.color,
        colorCode: entry.config.colorCode,
        configName: entry.config.name,
        vendorName: provider?.name ?? q.vendorId,
        vendorCountryCode: provider?.production?.default?.code ?? null,
        vendorStateCode: provider?.stateCode ?? null,
      });
    }

    const shipping: QuoteShippingOption[] =
      priceResponse.shippings || priceResponse.shipping || [];

    return {
      snapshot: { quotes, shipping, allComplete: priceResponse.allComplete },
      stats: { rawCount: priceResponse.quotes?.length ?? 0, droppedCount },
    };
  },

  async hasMaterial(materialId) {
    const catalog = await getCraftCloudCatalog();
    return catalog.materialById.has(materialId);
  },
};
