import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { DisputeButton } from "./dispute-button";

const REASON_COPY: Record<
  string,
  { title: string; description: string }
> = {
  geometry_collision: {
    title: "This listing was archived",
    description:
      "Our duplicate-detection found another listing with an identical 3D model uploaded earlier by a different creator. To keep the marketplace fair, this listing is hidden from buyers while you decide what to do — leave it archived, or let us know if you believe this is your original work.",
  },
};

interface ListingFlaggedBannerProps {
  fileId: string;
  reason: string;
  flaggedAt: Date;
}

/**
 * Owner-only banner that appears when fingerprintAndPersistAsset (or
 * the cron sweep) auto-archives the listing on a cross-user geometry
 * collision. Stays visible until the dispute flow (TODO) is built out;
 * for now the only action is the implicit "leave it" or contact-out-
 * of-band path.
 */
export function ListingFlaggedBanner({
  fileId,
  reason,
  flaggedAt,
}: ListingFlaggedBannerProps) {
  const copy = REASON_COPY[reason] ?? {
    title: "This listing was archived",
    description:
      "An automated review flagged this listing and removed it from public view.",
  };

  return (
    <Alert variant="destructive" className="mb-6">
      <AlertTitle>{copy.title}</AlertTitle>
      <AlertDescription>
        <p>{copy.description}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          Flagged {flaggedAt.toLocaleDateString()}.
        </p>
        <DisputeButton fileId={fileId} />
      </AlertDescription>
    </Alert>
  );
}
