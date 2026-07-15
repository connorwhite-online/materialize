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
import { Label } from "@/components/ui/label";
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
    null
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
          await Promise.all(photos.map((photo) => uploadPhotoToR2(photo)))
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
          : "Could not upload your evidence."
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
            <div className="overflow-hidden rounded-xl border bg-muted/20">
              {match.file.thumbnailUrl && (
                // The URL is persisted listing data and may point to R2/CDN.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={match.file.thumbnailUrl}
                  alt=""
                  className="aspect-video w-full object-cover"
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
                  <p className="truncate font-medium">
                    {match.file.name || "Existing private file"}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    Owned by {ownerName}
                  </p>
                </div>
              </div>
            </div>

            {claiming && (
              <div className="space-y-4 rounded-xl border p-3">
                <div className="space-y-1.5">
                  <Label htmlFor="ownership-claim-reason">
                    Tell us how you created this file
                  </Label>
                  <Textarea
                    id="ownership-claim-reason"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    rows={4}
                    maxLength={2000}
                    placeholder="Include when and how you made it, plus any source or publication details that can help us verify ownership."
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ownership-claim-photos">
                    Photographic evidence (optional)
                  </Label>
                  <Input
                    id="ownership-claim-photos"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    onChange={selectPhotos}
                  />
                  <p className="text-xs text-muted-foreground">
                    Up to {MAX_PHOTOS} JPG, PNG, or WEBP photos. Your original
                    model upload is already attached.
                  </p>
                  {photos.length > 0 && (
                    <p className="text-xs">
                      {photos.length} photo{photos.length === 1 ? "" : "s"} selected
                    </p>
                  )}
                </div>
              </div>
            )}

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}

            <DialogFooter className="sm:justify-between">
              {claiming ? (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={submitting}
                    onClick={() => setClaiming(false)}
                  >
                    Back
                  </Button>
                  <Button
                    type="button"
                    disabled={submitting}
                    onClick={submitClaim}
                  >
                    {submitting ? "Submitting…" : "Submit ownership claim"}
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setClaiming(true)}
                  >
                    This is my file
                  </Button>
                  {match.file.slug ? (
                    <Button render={<Link href={`/files/${match.file.slug}`} />}>
                      Go to this file
                    </Button>
                  ) : (
                    <Button type="button" disabled>
                      File is private
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
