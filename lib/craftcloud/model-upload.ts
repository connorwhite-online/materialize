/**
 * CraftCloud model upload — the three-step chain that replaced the
 * removed `POST /v5/model` endpoint.
 *
 * Around Aug 6 2026 CraftCloud dropped `/v5/model` (and
 * `/v5/model/{id}`) from `api.craftcloud3d.com` with no deprecation
 * notice; every upload started 404ing and all printing broke. The
 * endpoint is gone from their published spec
 * (`https://api.craftcloud3d.com/api-docs.json`) — the whole rest of
 * the pipeline (`/v5/price`, `/v5/cart`, `/v5/order`,
 * `/v5/payment/stripe`) is unchanged. Uploads moved to the
 * `customer-api` host (the same host `catalog.ts` already uses) and
 * became:
 *
 *   1. POST {CUSTOMER_API}/model/upload/initiate  {fileName, fileUnit}
 *        → 201 { uploadId, uploadUrl }
 *   2. PUT  <uploadUrl>  <bytes>          (S3 presigned, no auth)
 *   3. POST {CUSTOMER_API}/model/upload/confirm   {uploadId}
 *        → 201 [ { modelId, dimensions, volume, area, fileName,
 *                  fileUnit, thumbnailUrl, sceneId, isParsing } ]
 *
 * Shapes above are transcribed from craftcloud3d.com's own uploader
 * (DevTools capture) — the chain is NOT in their public spec, so
 * treat it as reverse-engineered and expect it to move again.
 *
 * Deliberately isomorphic — no `server-only`, nothing browser-only.
 * The web flows (quote configurator, anon draft upload) and the
 * server flow (MCP agent uploads via `client.ts`) run the identical
 * chain so there is exactly one place to fix next time.
 */

import type { FileUnit } from "./types";

export const CRAFTCLOUD_CUSTOMER_API_BASE =
  "https://customer-api.craftcloud3d.com";

/** Which leg of the chain failed — carried into telemetry. */
export type UploadStep = "initiate" | "transfer" | "confirm";

/** Sentinel `status` for a rejection that never produced a response. */
export const NETWORK_FAILURE_STATUS = 0;

export class CraftCloudUploadError extends Error {
  readonly step: UploadStep;
  readonly status: number;
  readonly responseBody: string;

  constructor(step: UploadStep, status: number, responseBody: string) {
    // Message stays terse because it surfaces directly in the print
    // page's error alert ("We couldn't load quotes for this file").
    //
    // The network-failure wording deliberately avoids the phrases in
    // instrumentation-client.ts's `ignoreErrors` list ("Failed to
    // fetch", "Load failed", "NetworkError when attempting to
    // fetch"). Sentry matches those as substrings against the
    // exception value, so echoing the browser's own message here
    // would get the event dropped by the noise floor — the exact
    // silence this whole chain of fixes exists to remove.
    super(
      status === NETWORK_FAILURE_STATUS
        ? `CraftCloud upload blocked or unreachable (${step})`
        : `CraftCloud upload failed: ${status}`
    );
    this.name = "CraftCloudUploadError";
    this.step = step;
    this.status = status;
    this.responseBody = responseBody;
  }
}

/** Mirrors client.ts's apiRequest: transient statuses worth retrying. */
const TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const RETRY_ATTEMPTS = 3;
const RETRY_BASE_MS = 200;

/**
 * Which legs may be re-sent after a transient failure.
 *
 *   initiate — safe. A duplicate only strands an unused uploadId on
 *              CraftCloud's side; nothing of ours references it yet.
 *   transfer — safe. A presigned S3 PUT of the same bytes to the same
 *              key is idempotent by construction.
 *   confirm  — NOT retried. This chain is reverse-engineered from
 *              CraftCloud's frontend, and we have no evidence that
 *              confirming one uploadId twice is idempotent. Assuming
 *              it is could mint duplicate models; a failed confirm
 *              surfaces to the user, who can retry deliberately.
 */
const RETRYABLE_STEPS: ReadonlySet<UploadStep> = new Set(["initiate", "transfer"]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * `fetch` for one leg of the chain, with network rejections converted
 * into a step-tagged CraftCloudUploadError, and transient failures
 * retried with exponential backoff on the legs where that is safe.
 *
 * A browser CORS refusal surfaces as a bare `TypeError` with no
 * response, and the new upload endpoints answer with
 * `Access-Control-Allow-Origin: https://craftcloud3d.com` rather than
 * `*` — so "our origin is not allowed" is a live possibility for this
 * chain, and it is the single most diagnostic failure we could get.
 * Left as a raw TypeError it would be muted by the client noise floor
 * and we would be blind again.
 *
 * Aborts still pass through untouched: a navigation mid-upload is not
 * a CraftCloud failure.
 */
async function fetchLeg(
  step: UploadStep,
  input: string,
  init?: RequestInit
): Promise<Response> {
  const attempts = RETRYABLE_STEPS.has(step) ? RETRY_ATTEMPTS : 1;
  let lastError: CraftCloudUploadError | undefined;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await fetch(input, init);
      if (res.ok || !TRANSIENT_STATUSES.has(res.status)) return res;
      // Transient status on a retryable leg: fall through to backoff.
      // The body is consumed here so the caller isn't handed a used
      // Response if this turns out to be the final attempt.
      lastError = new CraftCloudUploadError(
        step,
        res.status,
        await res.text().catch(() => "")
      );
    } catch (cause) {
      if ((cause as { name?: string })?.name === "AbortError") throw cause;
      const detail = cause instanceof Error ? cause.message : String(cause);
      lastError = new CraftCloudUploadError(
        step,
        NETWORK_FAILURE_STATUS,
        detail
      );
    }

    if (attempt < attempts - 1) {
      // 200ms, 800ms — same shape as client.ts's apiRequest.
      await sleep(RETRY_BASE_MS * Math.pow(4, attempt));
    }
  }

  throw lastError!;
}

export interface UploadedModel {
  modelId: string;
  dimensions: { x: number; y: number; z: number } | null;
  volume: number | null;
  surfaceArea: number | null;
  /**
   * Always null: the confirm response carries no triangle count. Kept
   * on the interface because callers (and `geometryData`) still have
   * the field — dropping it would be a wider refactor than this fix.
   */
  triangleCount: number | null;
  thumbnailUrl: string | null;
  /**
   * CraftCloud is still parsing the mesh. Their own uploader returns
   * `false` by the time confirm resolves; if it ever comes back true
   * the model may not be priceable yet.
   */
  isParsing: boolean;
}

interface InitiateResponse {
  uploadId?: string;
  uploadUrl?: string;
}

async function bodyText(res: Response): Promise<string> {
  return res.text().catch(() => "");
}

/**
 * Run the full upload chain and return the created model.
 *
 * Throws `CraftCloudUploadError` on any non-OK response so callers can
 * report `step` / `status` / `responseBody` to their own telemetry
 * (browser: `reportClientError`; server: `logError`). Network-level
 * rejections are also wrapped, tagged with the leg that failed and
 * `status: 0` — see `fetchLeg`. Aborts alone pass through raw.
 */
export async function uploadModelToCraftCloud(
  body: Blob | Uint8Array,
  fileName: string,
  fileUnit: FileUnit = "mm"
): Promise<UploadedModel> {
  const initiateRes = await fetchLeg(
    "initiate",
    `${CRAFTCLOUD_CUSTOMER_API_BASE}/model/upload/initiate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName, fileUnit }),
    }
  );
  if (!initiateRes.ok) {
    throw new CraftCloudUploadError(
      "initiate",
      initiateRes.status,
      await bodyText(initiateRes)
    );
  }

  const { uploadId, uploadUrl } = (await initiateRes.json()) as InitiateResponse;
  if (!uploadId || !uploadUrl) {
    throw new CraftCloudUploadError(
      "initiate",
      initiateRes.status,
      "initiate returned no uploadId/uploadUrl"
    );
  }

  // Presigned S3 PUT. No headers on purpose — the presigned signature
  // covers whatever CraftCloud signed, and volunteering a Content-Type
  // it didn't sign gets the request rejected.
  const transferRes = await fetchLeg("transfer", uploadUrl, {
    method: "PUT",
    body: body as BodyInit,
  });
  if (!transferRes.ok) {
    throw new CraftCloudUploadError(
      "transfer",
      transferRes.status,
      await bodyText(transferRes)
    );
  }

  const confirmRes = await fetchLeg(
    "confirm",
    `${CRAFTCLOUD_CUSTOMER_API_BASE}/model/upload/confirm`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uploadId }),
    }
  );
  if (!confirmRes.ok) {
    throw new CraftCloudUploadError(
      "confirm",
      confirmRes.status,
      await bodyText(confirmRes)
    );
  }

  // confirm returns an array, same as the old /v5/model did.
  const models = (await confirmRes.json()) as Array<Record<string, unknown>>;
  if (!Array.isArray(models) || models.length === 0) {
    throw new CraftCloudUploadError(
      "confirm",
      confirmRes.status,
      "confirm returned no models"
    );
  }

  const model = models[0];
  // A confirm payload without a modelId is a contract change, not a
  // usable model. Coercing it to "" would send an empty id into the
  // quote request and fail somewhere far less legible.
  if (typeof model.modelId !== "string" || model.modelId.length === 0) {
    throw new CraftCloudUploadError(
      "confirm",
      confirmRes.status,
      `confirm returned no modelId: ${JSON.stringify(model).slice(0, 200)}`
    );
  }

  const dimensions = model.dimensions as UploadedModel["dimensions"];
  return {
    modelId: model.modelId,
    dimensions: dimensions ?? null,
    volume: typeof model.volume === "number" ? model.volume : null,
    surfaceArea: typeof model.area === "number" ? model.area : null,
    triangleCount: null,
    thumbnailUrl:
      typeof model.thumbnailUrl === "string" ? model.thumbnailUrl : null,
    isParsing: model.isParsing === true,
  };
}
