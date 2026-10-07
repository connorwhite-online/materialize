"use client";

import Link from "next/link";
import { useState } from "react";
import { duplicateUploadDispute } from "@/app/actions/disputes";
import type { DuplicateUploadMatch } from "./run-create-listing";
import { uploadPhotoToR2, validatePhoto } from "@/lib/photos/upload-photo";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";

const MAX_PHOTOS = 5;

export function DuplicateUploadDialog({
  match,
  onClose,
}: {
  match: DuplicateUploadMatch;
  onClose: () => void;
}) {
  const [claiming, setClaiming] = useState(false);
  const [reason, setReason] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [uploadedPhotoKeys, setUploadedPhotoKeys] = useState<string[] | null>(
    null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ownerName =
    match.owner.displayName || match.owner.username || "the current creator";
  const ownerInitial = ownerName.slice(0, 1).toUpperCase();

  const selectPhotos = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    setError(null);
    if (selected.length > MAX_PHOTOS) {
      setError(`Attach no more than ${MAX_PHOTOS} photos.`);
      return;
    }
    const invalid = selected.map(validatePhoto).find(Boolean);
    if (invalid) {
      setError(invalid);
      return;
    }
    setPhotos(selected);
    setUploadedPhotoKeys(null);
  };

  const submitClaim = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const photoKeys =
        uploadedPhotoKeys ??
        (
          await Promise.all(
            photos.map((photo) =>
              uploadPhotoToR2(photo, { purpose: "ownership_claim" }),
            ),
          )
        ).map((result) => result.storageKey);
      setUploadedPhotoKeys(photoKeys);

      const result = await duplicateUploadDispute({
        claimIntentId: match.claimIntentId,
        reason,
        evidencePhotoKeys: photoKeys,
      });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setDone(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not upload your evidence.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {done ? "Ownership claim submitted" : "This file is already here"}
          </DialogTitle>
          <DialogDescription>
            {done
              ? "Our team will review the original model, your description, and any photos, then follow up by email."
              : "We found an exact binary match. The uploaded model has been retained temporarily so you can use it as evidence."}
          </DialogDescription>
        </DialogHeader>

        {!done && (
          <>
            <div className="overflow-hidden rounded-2xl ring-1 ring-border">
              {match.file.thumbnailUrl && (
                // The URL is persisted listing data and may point to R2/CDN.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={match.file.thumbnailUrl}
                  alt=""
                  className="aspect-video w-full bg-muted object-cover"
                />
              )}
              <div className="flex items-center gap-3 p-3">
                <Avatar>
                  {match.owner.avatarUrl && (
                    <AvatarImage src={match.owner.avatarUrl} alt="" />
                  )}
                  <AvatarFallback>{ownerInitial}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="truncate text-sm leading-5 font-medium">
                    {match.file.name || "Existing private file"}
                  </p>
                  <p className="truncate text-[13px] leading-[18px] text-muted-foreground">
                    Owned by {ownerName}
                  </p>
                </div>
              </div>
            </div>

            {claiming && (
              <div className="flex flex-col gap-5">
                <Field
                  label="How did you make this file?"
                  htmlFor="ownership-claim-reason"
                >
                  <Textarea
                    id="ownership-claim-reason"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    rows={4}
                    maxLength={2000}
                    autoFocus
                    placeholder="When and how you made it, plus anywhere you published it."
                  />
                </Field>
                <Field
                  label="Photos"
                  htmlFor="ownership-claim-photos"
                  optional
                  hint={
                    photos.length > 0
                      ? `${photos.length} photo${photos.length === 1 ? "" : "s"} selected. Your model upload is already attached.`
                      : `Up to ${MAX_PHOTOS} JPG, PNG or WebP photos. Your model upload is already attached.`
                  }
                >
                  <Input
                    id="ownership-claim-photos"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    onChange={selectPhotos}
                  />
                </Field>
              </div>
            )}

            {error && (
              <p
                role="alert"
                className="text-[13px] leading-[18px] text-destructive"
              >
                {error}
              </p>
            )}

            <DialogFooter>
              {claiming ? (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={submitting}
                    onClick={() => setClaiming(false)}
                  >
                    Back
                  </Button>
                  <Button
                    type="button"
                    loading={submitting}
                    disabled={reason.trim().length === 0}
                    onClick={submitClaim}
                  >
                    Submit claim
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    className="mr-auto"
                    onClick={() => setClaiming(true)}
                  >
                    This is my file
                  </Button>
                  {match.file.slug ? (
                    <Button
                      render={<Link href={`/files/${match.file.slug}`} />}
                    >
                      View file
                    </Button>
                  ) : (
                    <Button type="button" variant="secondary" onClick={onClose}>
                      Close
                    </Button>
                  )}
                </>
              )}
            </DialogFooter>
          </>
        )}

        {done && (
          <DialogFooter>
            <Button type="button" onClick={onClose}>
              Done
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
