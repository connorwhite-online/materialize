import { FolderOpenIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CollectionSettingsMenu } from "./collection-settings-menu";
import { cn } from "@/lib/utils";

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
 * Collection shelf in the profile Library view. Header is the
 * folder glyph + name, with a right-aligned visibility chip and
 * owner settings. Files outside a collection render in the Files
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
      : `${fileCount} ${fileCount === 1 ? "File" : "Files"}`;

  return (
    <section>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2 text-muted-foreground">
          <span className="flex shrink-0">
            <FolderOpenIcon className={compact ? "size-4" : "size-5"} />
          </span>
          <h2
            className={
              compact
                ? "min-w-0 truncate text-sm font-semibold"
                : "min-w-0 truncate text-lg font-semibold"
            }
          >
            {name}
          </h2>
          <Badge
            variant="outline"
            className={cn(
              "ml-4 h-6 shrink-0 px-2.5",
              // The "Empty" pill on mobile reads as clutter — phone
              // users can see at a glance that there's nothing
              // beneath the section header. Keep the count badge
              // ("3 Files") on every viewport, but hide the empty
              // state's badge below sm.
              fileCount === 0 && "hidden sm:inline-flex"
            )}
          >
            {countLabel}
          </Badge>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {showVisibilityBadge && (
            <Badge variant="outline" className="h-6 px-2.5 capitalize">
              {visibility}
            </Badge>
          )}
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
      </div>

      <div className="pt-4">
        {description && (
          <p className="mb-4 text-xs text-muted-foreground">{description}</p>
        )}
        {children}
      </div>
    </section>
  );
}
