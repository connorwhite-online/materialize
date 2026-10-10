/**
 * "Pneuma Robotics!" → "pneuma-robotics". Empty when nothing usable is
 * left. Same character set `buildUniqueHandle` keeps.
 */
export function slugifyOrganizationName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");
}
