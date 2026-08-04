# 10 — File identity & remix: what a file is, when it exists, and whose it is

## Why this doc

The studio mints real `files` rows per generation (so drafts are printable), which
raised the foundational questions: when does a generation *become* a file? Are
same-thread regenerations versions or new files? Can users remix each other's
work, and whose IP is the result? This doc records the decided model and fences
the genuinely-open policy questions. Companion to 05 (lifecycle/versioning),
which specs the draft-invisibility and one-file-per-design mechanics.

## The decided model

**A file exists in the library only through a deliberate act.** Every
generation still mints a `source='studio'`, `status='draft'` row immediately
(printability requires a real asset), but it is invisible on every library
surface (`notUnsavedStudioDraft()`, 05 §B) until one of:

- **Save to profile** — explicit promotion (`saveCadFileToProfile`).
- **Print order** — "an order is a save" (`promoteStudioDraftsForAssets`).
- **Download** — "a download is a save": the studio's STL Download button and
  assembly zip pass `?download=1` to `/api/files/preview/[fileAssetId]`, which
  promotes the owner's unsaved draft best-effort. A deliberate export means the
  artifact left the studio; the library should know it exists.
  - *Edge, accepted:* STEP downloads don't promote yet — the signed URL is
    minted by a render-time probe (`StepDownloadLink`), so there's no
    click-time server hook. STL/zip/save/print cover the intent; wire STEP
    when the probe becomes a click-time action.

**Same-thread regenerations are versions, not new files.** The thread is the
design (`cadThreads`); `savedFileId` is THE library file for it; re-saving a
revision re-points that file at the new geometry (same id/slug, 05 §C);
`parentGenerationId` encodes branch structure within the thread. No
collection/project auto-grouping is needed for single parts — the invariant
"one design = one file" removes the thing that would need grouping. Assemblies
already bundle into a Project.

**Legacy backfill (migration 0057).** Studio files minted before the `source`
column existed defaulted to `'upload'` and therefore leaked into the library as
thumbnail-less ghosts. 0057 re-tags any draft file whose asset a
`cad_generations` row points at.

## Provenance vs. ownership (the remix foundation)

Split the problem into a factual layer and a policy layer; only the second is
hard, and the first must not wait for it.

**Provenance is factual — record it forever, from day one.** Two immutable
edges (0057, no writers yet):

- `files.derivedFromFileId` — this file was derived from that one (remix,
  studio-edit-of-existing-file, any future derivation entry point).
- `cadGenerations.remixOfGenerationId` — this generation was seeded from a
  generation in ANOTHER thread (vs. `parentGenerationId`, which is
  within-thread revision structure).

Rules: write-once at creation of the derived row; never rewritten by licensing
or ownership changes; `SET NULL` only on actual source deletion. Every future
remix entry point ("open in studio" on someone's file, "remix this
generation") MUST write these edges even while remix *policy* is undecided —
the graph is cheap to capture now and impossible to reconstruct later.

**Ownership is policy — never a function of "how much remodeling."** Any
percent-changed threshold is unadjudicable. The settled model in 3D-print
marketplaces (Thingiverse/Printables, CC licensing):

- The derived artifact belongs to the remixer.
- The SOURCE file's license decides what derivations may do — whether remixing
  is allowed at all, whether remixes may be shared, whether they may be sold,
  and whether attribution is required. `files.license` already exists; the
  listing flow grows a remix-permission tier when remixing ships.
- Attribution persists unconditionally, because it is provenance (fact), not
  ownership (policy). UI: "remixed from X by Y", walkable both directions via
  `files_derived_from_idx`.

Consequence: "can user B remix user A's file?" is a license gate plus a
provenance edge — not an IP adjudication. Revenue-share on remix sales becomes
*possible later* because the graph exists.

## Open decisions (Needs Decision — do not implement without a call)

1. **Remix permission tiers** — which license enum values allow remix/share/
   sell, and what the default is for new listings (suggest: remixable
   non-commercial with attribution, mirroring `cc_by`-family defaults).
2. **Private-source remixes** — if A's file goes private after B remixed it,
   B's file stands (edge SET NULLs only on deletion); does attribution text
   survive as a snapshot? Suggest yes: denormalize creator handle at remix
   time.
3. **Purchase-to-remix** — does buying a paid file grant remix rights, or is
   that a separate license tier? Affects `entitlement.ts`.
4. **Agent remixes (MCP)** — an agent generating "like file X but…" on behalf
   of user B is a remix of X; the MCP tools must thread the same edges.
5. **GC interplay** — unsaved drafts accumulate forever (05 §E, still open);
   download-promotion shrinks the pile but the sweep still needs building.
