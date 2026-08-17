/**
 * Which artwork a project's OG card should show, and how it should
 * fill the frame.
 *
 * Kept pure and separate from the route so the decision can be unit
 * tested without a database — the route's job is to gather candidates,
 * this decides between them.
 */

/** Beyond a handful the tiles are too small to read as anything. */
export const MAX_STACK_TILES = 5;

export type ProjectCardChoice =
  | { kind: "cover"; imageUrl: string }
  | { kind: "single"; imageUrl: string; fit: "cover" | "contain" }
  | { kind: "stack"; imageUrls: string[] }
  | { kind: "none" };

export interface ProjectCardFile {
  /** `/api/thumbnails/{fileId}`, or null when nothing was ever captured. */
  thumbnailUrl: string | null;
  /**
   * Whether the file's thumbnail resolves to a curator-uploaded photo
   * rather than the auto-captured 3D render. It decides `fit`: a photo
   * is a photograph and should fill the frame, while a capture is a
   * transparent-background render of a model normalized to a square,
   * which `cover` would crop the extremities off.
   */
  hasCoverPhoto: boolean;
}

export function chooseProjectCard(input: {
  /**
   * The project's own cover art, already resolved to a fetchable URL —
   * the curator-picked cover, else the first curator photo, else the
   * legacy thumbnail. Null when the project has none.
   */
  coverImageUrl: string | null;
  /** The project's bundled files, in display order. */
  files: ProjectCardFile[];
}): ProjectCardChoice {
  // A project that has cover art is showing what its author chose.
  // Nothing derived beats that.
  if (input.coverImageUrl) {
    return { kind: "cover", imageUrl: input.coverImageUrl };
  }

  const withArt = input.files.filter(
    (f): f is ProjectCardFile & { thumbnailUrl: string } => !!f.thumbnailUrl
  );

  if (withArt.length === 0) return { kind: "none" };

  // One file is not a collection — a stack of one reads as a mistake,
  // and the file's own art deserves the whole frame.
  if (withArt.length === 1) {
    return {
      kind: "single",
      imageUrl: withArt[0].thumbnailUrl,
      fit: withArt[0].hasCoverPhoto ? "cover" : "contain",
    };
  }

  return {
    kind: "stack",
    imageUrls: withArt.slice(0, MAX_STACK_TILES).map((f) => f.thumbnailUrl),
  };
}
