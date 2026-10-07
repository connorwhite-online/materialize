import { Badge } from "@/components/ui/badge";
import { CollectionSettingsMenu } from "./collection-settings-menu";

interface CollectionSectionProps {
  collectionId: string;
  name: string;
  description?: string | null;
  visibility: "public" | "private" | string;
  showVisibilityBadge: boolean;
  isOwner: boolean;
  fileCount: number;
  compact?: boolean;
  children: React.ReactNode;
}

/**
 * Collection shelf in the profile Library view. Header is the name
 * with a muted count (same as LibrarySection), a "Private" chip only
 * when it isn't public, and the owner settings menu on the right. Files outside a collection render in the Files
 * carousel below.
 */
export function CollectionSection({
  collectionId,
  name,
  description,
  visibility,
  showVisibilityBadge,
  isOwner,
  fileCount,
  compact = false,
  children,
}: CollectionSectionProps) {
  const countLabel =
    fileCount === 0
      ? "Empty"
      : `${fileCount} ${fileCount === 1 ? "file" : "files"}`;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <h2
            className={
              compact
                ? "min-w-0 truncate text-sm leading-5 font-semibold"
                : "min-w-0 truncate text-base leading-6 font-semibold"
            }
          >
            {name}
          </h2>
          <span className="shrink-0 text-sm text-subtle-foreground tabular-nums">
            {countLabel}
          </span>
          {showVisibilityBadge && visibility !== "public" && (
            <Badge variant="secondary" className="shrink-0 capitalize">
              {visibility}
            </Badge>
          )}
        </div>
        {isOwner && (
          <CollectionSettingsMenu
            collectionId={collectionId}
            name={name}
            description={description ?? null}
            visibility={
              visibility === "public" || visibility === "private"
                ? visibility
                : "private"
            }
          />
        )}
      </div>
      {description && (
        <p className="-mt-1.5 text-[13px] leading-[18px] text-muted-foreground">
          {description}
        </p>
      )}
      {children}
    </section>
  );
}
