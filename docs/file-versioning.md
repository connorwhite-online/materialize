# File versioning

Status: phase 1 (data model, resolver, studio re-save) is built; phases 2–4
are planned. Decisions below were signed off by Connor on 2026-09-29.

## The shape in one paragraph

A **file** stays what it is today: the listing identity (slug, name, price, license, stats, comments, purchases). Behind it sits an ordered list of **versions**, each an immutable snapshot of geometry. The file carries one pointer, **current version**, and that is the only version the public ever sees. Owners see the whole list, can switch the page between versions, upload a new one, and make any older one current again. In the studio, every generation stays working history (as it is now), and **Save** becomes "save as a new version of this design's file" instead of the swap it does today.

## Before versioning (what the code did)

- `files` 1 → N `file_assets` already (`lib/db/schema.ts:544`, `fileAssets.fileId`). But nothing says which asset is "the" asset. About 35 readers pick "the first/only row" (49 `eq(fileAssets.fileId, …)` call sites), and some with no `ORDER BY` at all, e.g. `app/(app)/files/[slug]/page.tsx:159` then `assets[0]` at `:835`/`:852`. So a file can only safely hold one asset at a time.
- The studio works around that. `saveCadFileToProfile` (`app/actions/cad-generation.ts:161`) re-saves by **swapping asset rows between two files** so the saved file keeps exactly one asset, with a crash-ordering dance, and falls back to publishing a second file and demoting the first when orders, carts or projects reference either side. The old geometry survives only by being parked on an invisible draft file.
- Studio history is already good: `cadThreads` (thread = design), `cadGenerations.parentGenerationId` (branching), `activeGenerationId` (pinned version), `savedFileId` (one library file per design). Docs 05 §C and 10 already say "same-thread regenerations are versions, not new files" and name a `fileAssetVersions`-style v2 as the better answer. This plan is that v2, extended to uploads.
- Orders already pin geometry: `printOrders.fileAssetId` / `printOrderItems.fileAssetId` point at a specific asset. Immutable versions keep that true for free.
- Uploads have no "new version" path at all. Iterating on an uploaded part today means a brand-new listing (new slug, zero downloads, split comments). That's the Thingiverse "Widget v2, Widget v3" problem.

## How other tools do it

| Tool | Model | What we take |
|---|---|---|
| Onshape | Continuous edit history (every change, undoable) is separate from **named, immutable Versions** you create deliberately. Branches off any version; releases are a further step. | The split between *history* (studio generations) and *versions* (deliberate saves). This is the most important idea. |
| Fusion | Every save is a version (v1, v2…) in a version list. **Promote** makes an old version the latest. | Plain numbered versions, and "Make current" on any old one. |
| GrabCAD Workbench | Versions with a check-in comment, rollback, compare. | A short optional note per version. |
| Printables | Files on a model can be updated in place; the page keeps its URL, likes and comments. No formal public version list that I know of. | The public page stays one URL and just shows the latest, with an "updated" date. |
| Thingiverse | No versioning. People publish "v2" as a new thing or a remix. | The anti-pattern to avoid. |
| GitHub | Commits, branches, merges, diffs. | Mostly overkill, as you said. Worth borrowing only: an immutable id per version, a note, and "compare two". No merges; CAD doesn't merge. |

## Decisions

1. **Only the current version is public.** The public page, browse, search, OG card and quote flow all resolve the current version. No version count shown publicly.
2. **Owners see full history** on their own file page: a version switcher (`v4 · current ▾`), each with date, note, dimensions and thumbnail.
3. **Public history is opt-in per file** (`files.showVersionHistory`, default off). When on, visitors see a read-only changelog (version, date, note) and can view older versions. Downloading an old version stays owner-only in the first cut.
4. **"Make current" moves the pointer**; it does not copy. Reversible, no duplicate rows. (Fusion's promote copies; with immutable rows we don't need to.)
5. **Buyers get the current version.** Entitlement is already per file, so a purchase covers future versions automatically. Order pages show the version that was ordered and say when a newer one exists.
6. **Studio: generations are history, saves are versions.** Not every generation becomes a library version, only the ones you Save (or print or download, which already count as saves). The version note defaults to the generation's prompt, editable.
7. **No branches in the library.** Branching stays in the studio thread, where `parentGenerationId` already models it. A library file's versions are a straight line.
8. **Only files have versions, never projects.** A project is a bundle of files; it shows each bundled file's current version and has no version history of its own. Updating a part updates every project it's in.

## Data model

Smallest change that works, treating each `file_assets` row as a version (the STEP sidecar already rides on the same row, so one row = one full snapshot):

```
files
  + current_asset_id   uuid  FK file_assets  ON DELETE SET NULL
  + show_version_history boolean NOT NULL DEFAULT false

file_assets
  + version_number     integer          -- 1, 2, 3… per file; unique (file_id, version_number)
  + version_note       text             -- optional
```

Studio provenance needs no column: `cad_generations.file_asset_id` already points from each generation at the asset (version) it produced, and is indexed.

Why not a separate `file_versions` table: every version has exactly one geometry, which is exactly an asset row, and orders/carts/craftcloud already key on `fileAssetId`. A second table would just be a 1:1 wrapper plus a join on every read. If multi-file versions (e.g. STL + 3MF + drawings as one version) arrive later, that's the point to introduce the table.

Invariants:
- Asset rows are immutable once attached to a file (geometry, hashes, storage keys never change). New geometry = new row.
- `current_asset_id` always points at an asset of the same file. `attachAssetAsVersion` clears the old file's pointer when it moves an asset between files.
- Backfill: `version_number` = order by `created_at`; `current_asset_id` = the oldest asset (matches what the ordered readers pick today, and the crash-state comment in `saveCadFileToProfile`).

## Code shape

- One resolver, `lib/files/current-version.ts` (pure): `pickCurrentAsset(currentAssetId, assets)`, `currentAssetsByFileId(rows, pointers)` for batched readers, and `isCurrentAsset()` as a SQL filter for `file_assets ⋈ files` joins. Every "the file's asset" reader goes through it; this also fixed the unordered `assets[0]` read on the file page.
- One writer, `lib/files/versions.ts` → `attachAssetAsVersion({ fileId, assetId, note, makeCurrent })`: assigns the next number, attaches the asset, moves the pointer. New files get v1 + the pointer at insert (`createFileListing`, `createDraftFileForUser`, MCP `registerUploadForUser`).
- `saveCadFileToProfile`: first save publishes the file (unchanged); re-save calls `attachAssetAsVersion` with the generation's asset. The asset swap and the order-reference fallback are gone: nothing mutates an asset, so order references stop being a blocker. Studio assemblies (a generation with a `projectId`) keep the old publish-new/demote-old fallback until per-part re-save is built.
- Readers that still mean "every version" on purpose: the file page's order/print stats, entitlement "has printed", earnings, deletion and GC.
- Duplicate-geometry guard: if the new asset's `contentHash` equals the current version's, don't add a version.

## Phases

**Phase 1 (done): foundation, no visible change.** Migration + backfill, the resolver and writer, move all readers onto the resolver, and rewrite studio re-save onto `addFileVersion`. Tests pin: readers only ever see the current version; an ordered asset never changes; re-save on an ordered file adds v2 instead of forking a second file.

**Phase 2: owner version UI on `/files/[slug]`.** Version switcher (`?v=3`, owner-only unless history is public), "Upload new version" (reuses the existing presign → R2 → fingerprint path), note field, "Make current". Thumbnail and saved camera angle are per version going forward.

**Phase 3: studio ↔ library link.** Studio revision list badges which generations became library versions ("saved as v3"); the file page's owner view links each studio version back to its generation. Save dialog pre-fills the note from the prompt.

**Phase 4: sharing and compare.** The public-history toggle and changelog; "compare with…" using the ghost overlay the studio frame already makes nearly free (05 §D.3), plus a dimensions/volume diff for uploads and the parameter diff for studio code (05 §D.4). Optional "updated" notification to buyers and people who printed it (`notifications.type` is free text, no migration).

## Open questions (defaults accepted)

1. Should buyers be able to download the exact version they bought, or only the current one? Default: current only; the owner can always make an older one current.
2. Should a new version bump the file's `updatedAt` so it resurfaces in "fresh" browse ordering? Default: no (it's easy to game); show an "Updated" label instead.
3. ~~Projects/assemblies~~ Decided: only files are versioned (decision 8).
4. Should the public page say "Updated <date>" when there's more than one version, even with history hidden? Default: yes; it's reassuring and reveals no count.

Answered on 2026-09-29: all defaults above stand.
