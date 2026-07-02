# 05 — Lifecycle & versioning: threads first-class, drafts invisible, one file per design

## Current state (verified)

- **Every successful generation immediately mints real `files` + `file_assets` rows** via
  `createDraftFileForPrint` (`lib/cad/persist.ts:143-149` → `app/actions/files.ts:844-985`),
  status `draft`, visibility `private` (or the user's `defaultUploadVisibility`). Byte-hash
  dedup silently reuses an existing asset for identical regenerations.
- **"Save to profile" does not create anything** — `saveCadFileToProfile`
  (`app/actions/cad-generation.ts:139-170`) flips the existing file to
  `status='published', visibility='private'`.
- **Versioning is a parent-pointer chain**: `cadGenerations.parentGenerationId`
  (`lib/db/schema.ts:1389-1391`). Threads are reconstructed at read time by loading the
  user's latest 100 rows and walking chains (`rootIdOf`,
  `app/(app)/prometheus/page.tsx:138-153`) — fragments beyond 100 rows (noted in MTR-48).
  The root row alone carries `title`; `renameCadGeneration` walks to the root with one
  SELECT per ancestor (N+1, MTR-48).
- **Each generation = its own library file.** A 6-revision thread leaves 6 draft files.
- **GC gaps**: render PNGs (`cad-renders/`) are never swept — the orphan cron
  (`app/api/cron/cleanup-orphan-uploads/route.ts`) only lists the `uploads/` prefix; and
  `deleteCadBuild` (`app/actions/cad-generation.ts:330-357`) deletes generation rows but
  not their render objects. Unsaved draft files accumulate forever.

## Product intent

Files should exist *outside the studio* only when the user saves or prints. A design
should be **one** library entry with N versions behind it — not N sibling files. The
studio should support branching, comparison, and choosing the active version.

## Spec

### A. `cadThreads` table (threads become first-class)

```
cadThreads: id, userId, title, rootGenerationId (FK), activeGenerationId (FK),
            savedFileId (FK files, nullable), createdAt, updatedAt
cadGenerations: + threadId (FK cadThreads, indexed)
```

- The generate route creates a thread on root generations; revisions carry `threadId`
  from the parent. Keep `parentGenerationId` — it encodes the *branch structure* within
  a thread (revising an older turn = a fork; the column already supports it).
- `title` moves to the thread (root-row title becomes legacy-read fallback during
  migration). `renameCadGeneration`'s N+1 root-walk dies with it.
- `/prometheus` page queries threads directly (no chain reconstruction, no 100-row
  fragmentation). Backfill migration: group existing rows by walking chains once,
  server-side.
- `activeGenerationId` = which version the thread currently "is" (defaults to latest
  successful; user can pin — see D).

### B. Studio-draft stage (library invisibility)

Add `files.source` (text: `'upload' | 'studio'`, default `'upload'`) — or an equivalent
flag chosen at implementation time; the requirement is a **cheap, indexed discriminator**.

- `persistGenerationSuccess`/`persistAssembly` create files with `source='studio'`.
- Library/profile/marketplace queries exclude `source='studio'` files that are still
  `status='draft'` (audit the consumers of files listings: dashboard uploads, profile
  tabs, `/files`, search, MCP file tools).
- **Promotion** to a visible library file happens on: explicit Save (existing action), or
  implicitly on **print checkout** (an order is a save) — hook where the print flow
  loads the asset (`app/(app)/print/[fileAssetId]`) or at `createPrintOrder`.
- The `/print/[fileAssetId]` owner-or-published access check already admits the owner
  for private drafts — printing an unsaved draft keeps working throughout.

### C. One file per design (save updates, not multiplies)

When a thread is saved, `savedFileId` points at THE file for that design. Saving a newer
version **re-points that same file's asset** rather than publishing a second file:

- v1 (minimal): update the existing `file_assets` row's `storageKey` (upload the new STL
  first, then swap; keep hashes in sync; re-run `fingerprintAndPersistAsset`).
- v2 (better): `file_assets` grows a version list or a `fileAssetVersions` table so old
  versions remain downloadable and print orders keep a stable snapshot of what was
  ordered. **Print-order integrity is the constraint**: `printOrders.fileAssetId` must
  keep meaning "the geometry that was ordered" — never mutate an asset referenced by an
  order; instead create a new asset row and re-point `files`.
- Unsaved sibling drafts from other versions of the thread become GC-able (below).

### D. Studio version UX

Data model above unlocks, in order of value-per-effort:

1. **Thumbnails in the revisions list** — per-turn renders already exist
   (`renderStorageKey`); the list (`text-to-cad-studio.tsx:1068-1118`) is text-only today.
2. **Pin as active** — sets `activeGenerationId`; badge the pinned turn.
3. **Compare/overlay** — render two versions ghosted in the same fixed frame. The
   deterministic `studio-frame.ts` transform (`frameTransformFor`) means both meshes land
   in an identical camera/scale — overlay is nearly free and reads as magic.
4. **Parameter diff** — the code is parametric by contract (named dims at the top, per
   `SYSTEM_PROMPT`). Parse top-level `name = number` assignments from both versions'
   `sourceCode` and diff them: "wall: 2.0 → 2.4, corner_r: 6 → 8". Cheap, legible, and
   no mesh-diff could ever say it as well.
5. **Fork rendering** — when `parentGenerationId` ≠ previous turn, indent as a branch.
   No graph UI until someone needs it.

### E. GC (close the leaks)

- Extend the orphan cron (or add a sibling `cleanup-studio-artifacts`) to sweep:
  `cad-renders/` objects with no matching `renderStorageKey` (and, once doc 01 phase 2
  lands, `cad-topo/`); studio-draft files (+ assets + R2) belonging to threads with no
  save and no order reference, older than N days (default 30); failed generation rows'
  R2 leftovers.
- `deleteCadBuild` deletes its render objects (and topo objects) alongside the rows.
- Guard rails: never GC an asset referenced by `printOrders`/`cartItems`/`projectFiles`;
  keep the existing 24h age guard pattern from `cleanup-orphan-uploads`.

## Acceptance

- A 6-revision unsaved thread shows **zero** entries in the library; Save produces
  exactly one; printing an unsaved draft auto-promotes exactly one.
- Re-saving after two more revisions updates that same library entry (slug stable), and
  a print order placed against the older version still references the old geometry.
- `/prometheus` renders threads correctly for a user with >100 generations.
- R2 object count under `cad-renders/` stops growing monotonically (cron metric).
- MTR-48 items 1–2 (rename N+1, >100 fragmentation) become obsolete — close them.

## Open questions

1. Should assemblies' per-part files follow the same one-file-per-design rule per part,
   or should the **project** be the saved unit? Default: project = the design; parts
   follow the thread's save state together.
2. Retention window for unsaved drafts (30 days proposed) — owner's call; make it env.

## Dependencies

- Coordinate with MTR-50 (thumbnails) — B/E change where renders live in the file's
  cover story. MTR-48 partially superseded. No dependency on docs 01–04.
