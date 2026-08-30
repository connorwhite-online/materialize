/**
 * CraftCloud catalog images are either absolute Cloudinary URLs or
 * path fragments that need the All3DP upload prefix. Shared so the
 * material grid and the finish picker can't drift on host / transforms.
 */
export function resolveCatalogImage(path: string): string {
  if (path.startsWith("http")) return path;
  return `https://res.cloudinary.com/all3dp/image/upload/w_200,q_auto,f_auto/${path}`;
}
