/**
 * JSON-LD builders for the public listing pages. Centralized here so
 * the shapes stay consistent across files / projects / profiles —
 * Google's Rich Results validator gets quite cranky about subtle
 * differences in how the same `Person` is represented across pages.
 *
 * Each builder returns a plain object; the consuming page serializes
 * it into a `<script type="application/ld+json">` tag.
 */

// Same fallback ladder as the rest of the app — NEXT_PUBLIC_APP_URL in
// production, materialize.cc as the public fallback so local dev
// doesn't poison the URLs.
const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://materialize.cc";

function abs(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${APP_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

type PersonInput = {
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  bio?: string | null;
};

/**
 * The author / profile-subject Person object. Used both as a top-level
 * `@type: "Person"` on the profile page and as the `author` slot in
 * the file / project schemas. `@id` is the canonical profile URL so
 * Google can reconcile the same person across pages.
 */
export function personJsonLd(person: PersonInput) {
  const profileUrl = person.username ? abs(`/u/${person.username}`) : undefined;
  return {
    "@type": "Person",
    ...(profileUrl ? { "@id": profileUrl } : {}),
    name: person.displayName || person.username || "Materialize creator",
    ...(person.username ? { alternateName: person.username } : {}),
    ...(person.avatarUrl ? { image: person.avatarUrl } : {}),
    ...(profileUrl ? { url: profileUrl } : {}),
    ...(person.bio ? { description: person.bio } : {}),
  };
}

export function profilePageJsonLd(person: PersonInput) {
  if (!person.username) return null;
  const profileUrl = abs(`/u/${person.username}`);
  return {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    url: profileUrl,
    mainEntity: personJsonLd(person),
  };
}

type FileInput = {
  slug: string;
  name: string;
  description: string | null;
  thumbnailUrl: string | null;
  license: string | null;
  price: number; // cents, 0 = free
  createdAt: Date | string;
  author: PersonInput;
};

/**
 * Files are 3D-printable models — `3DModel` is the schema.org type
 * that fits closest. We pair it with an `Offer` for sellable files so
 * search engines surface price/availability the same way they do for
 * the materials catalog.
 */
export function fileJsonLd(file: FileInput) {
  const fileUrl = abs(`/files/${file.slug}`);
  const priceUsd = (file.price / 100).toFixed(2);
  return {
    "@context": "https://schema.org",
    "@type": "3DModel",
    "@id": fileUrl,
    name: file.name,
    ...(file.description ? { description: file.description } : {}),
    url: fileUrl,
    ...(file.thumbnailUrl ? { image: abs(file.thumbnailUrl) } : {}),
    encodingFormat: "model/stl",
    isAccessibleForFree: file.price === 0,
    ...(file.license ? { license: file.license } : {}),
    dateCreated:
      file.createdAt instanceof Date
        ? file.createdAt.toISOString()
        : file.createdAt,
    creator: personJsonLd(file.author),
    author: personJsonLd(file.author),
    offers: {
      "@type": "Offer",
      url: fileUrl,
      price: priceUsd,
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
    },
  };
}

type ProjectInput = {
  slug: string;
  name: string;
  description: string | null;
  thumbnailUrl: string | null;
  license: string | null;
  price: number;
  createdAt: Date | string;
  author: PersonInput;
  /** Optional list of bundled file slugs for `hasPart`. */
  fileSlugs?: string[];
};

/**
 * Projects bundle N printable files plus optional BOM + wiring. The
 * cleanest schema.org match is `CreativeWork` with each bundled file
 * referenced via `hasPart` → another `3DModel`. We also surface the
 * Offer for the bundle as a whole.
 */
export function projectJsonLd(project: ProjectInput) {
  const projectUrl = abs(`/projects/${project.slug}`);
  const priceUsd = (project.price / 100).toFixed(2);
  return {
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    "@id": projectUrl,
    name: project.name,
    ...(project.description ? { description: project.description } : {}),
    url: projectUrl,
    ...(project.thumbnailUrl ? { image: abs(project.thumbnailUrl) } : {}),
    isAccessibleForFree: project.price === 0,
    ...(project.license ? { license: project.license } : {}),
    dateCreated:
      project.createdAt instanceof Date
        ? project.createdAt.toISOString()
        : project.createdAt,
    creator: personJsonLd(project.author),
    author: personJsonLd(project.author),
    ...(project.fileSlugs && project.fileSlugs.length > 0
      ? {
          hasPart: project.fileSlugs.map((slug) => ({
            "@type": "3DModel",
            "@id": abs(`/files/${slug}`),
            url: abs(`/files/${slug}`),
          })),
        }
      : {}),
    offers: {
      "@type": "Offer",
      url: projectUrl,
      price: priceUsd,
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
    },
  };
}
