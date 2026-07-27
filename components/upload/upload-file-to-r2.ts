import { reportClientError } from "@/lib/observability/report-client-error";

export type UploadFormat = "stl" | "obj" | "3mf" | "step" | "amf";

export interface UploadFileToR2Params {
  file: File;
  /**
   * Filename sent to the presign endpoint. Defaults to `file.name` —
   * only cart materialization currently overrides this (it tracks a
   * separate `originalFilename` alongside the raw `File`).
   */
  filename?: string;
  /**
   * Tags every `reportClientError` call this upload makes, so Sentry
   * can tell which call site an upload failure came from without
   * guessing from the stack trace alone.
   */
  kind: "anon-print" | "authed-print" | "create-listing" | "cart-materialize";
  /**
   * 0-100, fired as the R2 PUT progresses. XHR-only signal — `fetch`
   * doesn't expose upload progress on the client, which is exactly
   * why this helper uses XHR for the PUT leg even for callers that
   * don't pass this.
   */
  onProgress?: (percent: number) => void;
}

export type UploadFileToR2Result =
  | { storageKey: string; format: UploadFormat }
  | { error: string };

/**
 * The shared presign -> R2 PUT sequence used by every client upload
 * path (anon print checkout, authed "Print this file", cart
 * materialization, create-listing). This used to be copy-pasted four
 * times with drifted error strings and inconsistent Sentry coverage —
 * every copy reported the R2-PUT-status-failure branch, but a presign
 * failure or a network/CORS error during the PUT produced no signal
 * at all anywhere (MONEY-3). This helper reports at every failure
 * exit: presign non-OK, presign network error, PUT non-2xx, and PUT
 * network/CORS error.
 *
 * Callers keep their own next step (createDraftFileForPrint /
 * createFileListing / addToCart) and their own double-fire guards
 * (`checkoutInFlightRef`, `materializingRef`, etc.) — per AGENTS.md
 * "double-fire guards live in the callers," those must NOT move into
 * this helper.
 */
export async function uploadFileToR2(
  params: UploadFileToR2Params
): Promise<UploadFileToR2Result> {
  const { file, kind, onProgress } = params;
  const filename = params.filename ?? file.name;

  let presignRes: Response;
  try {
    presignRes = await fetch("/api/upload/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename,
        contentType: "application/octet-stream",
        fileSize: file.size,
      }),
    });
  } catch (err) {
    reportClientError(
      "upload.presign-network-error",
      err instanceof Error ? err : new Error("Presign request failed"),
      { kind, fileSize: file.size }
    );
    return { error: "Couldn't reach the upload service. Please try again." };
  }

  if (!presignRes.ok) {
    const data = await presignRes.json().catch(() => ({}));
    const error =
      (data as { error?: string }).error ||
      `Upload presign failed (${presignRes.status})`;
    reportClientError("upload.presign-failed", new Error(error), {
      status: presignRes.status,
      kind,
      fileSize: file.size,
    });
    return { error };
  }

  const { uploadUrl, storageKey, format } = (await presignRes.json()) as {
    uploadUrl: string;
    storageKey: string;
    format: UploadFormat;
  };

  try {
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.upload.addEventListener("progress", (ev) => {
        if (ev.lengthComputable) {
          onProgress?.(Math.round((ev.loaded / ev.total) * 100));
        }
      });
      xhr.addEventListener("load", () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
          return;
        }
        // A real HTTP status came back, so the request reached R2 and
        // CORS is fine — don't misdirect to a network/CORS message.
        // Report to Sentry explicitly: this is a handled error shown
        // in the UI, so client Sentry won't auto-capture it — without
        // this an outage that fails every PUT produces no signal.
        const err = new Error(`R2 upload failed (${xhr.status})`);
        reportClientError("upload.r2-put-failed", err, {
          status: xhr.status,
          kind,
          storageKey,
          fileSize: file.size,
        });
        reject(err);
      });
      xhr.addEventListener("error", () => {
        const err = new Error(
          "Couldn't reach R2 (network or CORS). Please try again."
        );
        reportClientError("upload.r2-put-network-error", err, {
          kind,
          storageKey,
          fileSize: file.size,
        });
        reject(err);
      });
      xhr.open("PUT", uploadUrl);
      xhr.setRequestHeader("Content-Type", "application/octet-stream");
      xhr.send(file);
    });
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "File upload failed",
    };
  }

  return { storageKey, format };
}
