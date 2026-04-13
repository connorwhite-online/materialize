import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { files, users } from "@/lib/db/schema";
import { and, eq, ilike, or, desc } from "drizzle-orm";
import { getCraftCloudCatalog } from "@/lib/craftcloud/catalog";
import { logError } from "@/lib/logger";

const PER_CATEGORY_LIMIT = 8;

export interface SearchHitFile {
  type: "file";
  id: string;
  slug: string;
  name: string;
  thumbnailUrl: string | null;
  creatorUsername: string | null;
  creatorDisplayName: string | null;
}

export interface SearchHitUser {
  type: "user";
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface SearchHitMaterial {
  type: "material";
  id: string;
  slug: string;
  name: string;
  groupName: string;
  featuredImage: string | null;
}

export interface SearchResponse {
  files: SearchHitFile[];
  users: SearchHitUser[];
  materials: SearchHitMaterial[];
}

/**
 * Global search used by the home bottom bar. Returns up to
 * PER_CATEGORY_LIMIT hits per type. Each axis is independent —
 * materials search is in-memory over CraftCloud's cached catalog,
 * files + users hit the DB with ilike.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();

  if (!q) {
    return NextResponse.json<SearchResponse>({
      files: [],
      users: [],
      materials: [],
    });
  }

  const pattern = `%${q}%`;

  try {
    const [fileRows, userRows, catalog] = await Promise.all([
      db
        .select({
          id: files.id,
          slug: files.slug,
          name: files.name,
          thumbnailUrl: files.thumbnailUrl,
          creatorUsername: users.username,
          creatorDisplayName: users.displayName,
        })
        .from(files)
        .innerJoin(users, eq(files.userId, users.id))
        .where(
          and(
            eq(files.status, "published"),
            eq(files.visibility, "public"),
            ilike(files.name, pattern)
          )
        )
        .orderBy(desc(files.createdAt))
        .limit(PER_CATEGORY_LIMIT),
      db
        .select({
          id: users.id,
          username: users.username,
          displayName: users.displayName,
          avatarUrl: users.avatarUrl,
        })
        .from(users)
        .where(
          and(
            // Usernames are public, empty strings are impossible for
            // an onboarded user — safe to search directly.
            or(
              ilike(users.username, pattern),
              ilike(users.displayName, pattern)
            )
          )
        )
        .limit(PER_CATEGORY_LIMIT),
      getCraftCloudCatalog(),
    ]);

    // Material search runs over the in-memory catalog. Match on
    // material name OR group name, case-insensitive substring.
    const needle = q.toLowerCase();
    const materials: SearchHitMaterial[] = [];
    outer: for (const group of catalog.groups) {
      for (const material of group.materials) {
        const nameHit = material.name.toLowerCase().includes(needle);
        const groupHit = group.name.toLowerCase().includes(needle);
        if (!nameHit && !groupHit) continue;
        materials.push({
          type: "material",
          id: material.id,
          slug: material.slug,
          name: material.name,
          groupName: group.name,
          featuredImage: material.featuredImage ?? null,
        });
        if (materials.length >= PER_CATEGORY_LIMIT) break outer;
      }
    }

    const filesOut: SearchHitFile[] = fileRows.map((r) => ({
      type: "file",
      id: r.id,
      slug: r.slug,
      name: r.name,
      thumbnailUrl: r.thumbnailUrl,
      creatorUsername: r.creatorUsername,
      creatorDisplayName: r.creatorDisplayName,
    }));

    const usersOut: SearchHitUser[] = userRows
      .filter(
        (u): u is typeof u & { username: string } =>
          typeof u.username === "string" && u.username.length > 0
      )
      .map((r) => ({
        type: "user",
        id: r.id,
        username: r.username,
        displayName: r.displayName,
        avatarUrl: r.avatarUrl,
      }));

    return NextResponse.json<SearchResponse>({
      files: filesOut,
      users: usersOut,
      materials,
    });
  } catch (error) {
    logError("api/search", error);
    return NextResponse.json(
      { error: "Search failed" },
      { status: 500 }
    );
  }
}
