import "server-only";

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { requireEnv } from "./env";

let _s3: S3Client | null = null;

function getS3() {
  if (!_s3) {
    _s3 = new S3Client({
      region: "auto",
      endpoint: `https://${requireEnv("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
        secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
      },
      // aws-sdk v3.729+ defaults requestChecksumCalculation to
      // "WHEN_SUPPORTED", which folds an x-amz-checksum-crc32 header
      // into the SIGNED set of every PutObject — including presigned
      // URLs. The browser then PUTs the file without computing that
      // checksum, and Cloudflare R2 (incomplete flexible-checksum
      // support) rejects the mismatch with a 500, surfacing as
      // "R2 upload failed (500)" on every upload. Pin both knobs to
      // "WHEN_REQUIRED" so presigned PUTs match a plain browser PUT.
      // (R2 also doesn't implement response checksum validation.)
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }
  return _s3;
}

function getBucket() {
  return requireEnv("R2_BUCKET_NAME");
}

export async function generateUploadUrl(
  key: string,
  contentType: string,
  expiresIn = 3600
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: getBucket(),
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(getS3(), command, { expiresIn });
}

/**
 * Server-side write of bytes we generated ourselves (e.g. a CAD model
 * the text-to-CAD harness produced) straight to R2 — no presign/browser
 * round-trip. Callers must still place the object under the right
 * `uploads/{userId}/...` prefix so downstream ownership guards
 * (createDraftFileForPrint) accept it.
 */
export async function putObject(
  key: string,
  body: Uint8Array,
  contentType: string
): Promise<void> {
  const command = new PutObjectCommand({
    Bucket: getBucket(),
    Key: key,
    Body: body,
    ContentType: contentType,
  });
  await getS3().send(command);
}

/**
 * Server-side read of an object's bytes straight from R2 — for pipelines that
 * need the content in-process (e.g. the text-to-CAD harness re-importing a
 * cached step.parts STEP into the sidecar session, MTR-200) rather than a
 * browser download URL.
 */
export async function getObjectBytes(key: string): Promise<Uint8Array> {
  const result = await getS3().send(
    new GetObjectCommand({ Bucket: getBucket(), Key: key })
  );
  const bytes = await result.Body?.transformToByteArray();
  if (!bytes) throw new Error(`R2 object ${key} had no body`);
  return bytes;
}

export async function generateDownloadUrl(
  key: string,
  expiresIn = 3600
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: getBucket(),
    Key: key,
  });
  return getSignedUrl(getS3(), command, { expiresIn });
}

export async function objectExists(
  key: string
): Promise<{ exists: true; sizeBytes: number } | { exists: false }> {
  try {
    const result = await getS3().send(
      new HeadObjectCommand({ Bucket: getBucket(), Key: key })
    );
    return { exists: true, sizeBytes: result.ContentLength ?? 0 };
  } catch (err) {
    const status = (err as { $metadata?: { httpStatusCode?: number } })
      .$metadata?.httpStatusCode;
    const name = (err as { name?: string }).name;
    if (status === 404 || name === "NotFound" || name === "NoSuchKey") {
      return { exists: false };
    }
    throw err;
  }
}

export async function deleteObject(key: string): Promise<void> {
  const command = new DeleteObjectCommand({
    Bucket: getBucket(),
    Key: key,
  });
  await getS3().send(command);
}
