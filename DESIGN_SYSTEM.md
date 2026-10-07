# Materialize Design System

Built on ChatGPT's design system (OpenAI Apps SDK UI, MIT), with patterns
taken from Linear, Vercel, Cursor, ElevenLabs and Shop. The tokens live in
`app/globals.css`; the primitives in `components/ui/`. This file is the
rulebook: when a page disagrees with it, the page is wrong.

The one idea underneath everything: **the interface gets out of the way of
the work.** Few borders, flat fills, compact controls, generous space,
one accent (blue) reserved for focus. A complex flow is simplified by
showing less at once, not by drawing more boxes around it.

## Color

- Canvas `--background` is white (#212121 dark). Surfaces step up the gray
  ramp (`muted` #f3f3f3) rather than adding shadow.
- Borders are alpha hairlines (`border-border`, black 10%). Never a
  hand-picked gray.
- Text: `foreground` #0d0d0d, `muted-foreground` #5d5d5d for secondary,
  `subtle-foreground` #8f8f8f for timestamps/placeholders/captions.
- Status colors (`destructive`, `success`, `warning`, `info`) appear as text
  or a soft 10% fill, never as a big saturated panel.
- No gradients, no tinted washes, no glow.

## Type

| Role | Class |
| --- | --- |
| Page title | `text-2xl leading-7 font-semibold` |
| Section title | `text-base leading-6 font-semibold` |
| Body / control text | `text-sm` (14/20) |
| Meta, hints | `text-[13px] leading-[18px] text-muted-foreground` |
| Caption, eyebrow | `text-xs text-subtle-foreground` |

Semibold (600) is the heaviest weight. Never `font-bold` on UI. Tracking 0.
Prices and counts get `tabular-nums`.

## Space and layout

- 4px grid. Page gutter 16px on phones, content capped by `<Page width>`.
- **Don't box things that aren't objects.** A form, a settings panel or a
  description is not a card. Cards (`Card`, `rounded-2xl ring-1
  ring-border`) are for *things*: a file, an order, a material, a vendor.
- Group with space and a section title first, a hairline divider second,
  a card last.
- Desktop pages with a primary object (file, print quote, order) use two
  columns: the object (viewer/media) on the left, the decision (price,
  options, CTA) in a sticky column on the right. Phones stack them.

## Controls

- **Buttons are natural width.** Never `w-full` on a page. The exceptions:
  auth forms (the column is already ~22rem), bottom sheets, and a sticky
  mobile CTA bar. Pair actions at natural width: secondary then primary.
- Sizes: `sm` 32px, default 36px, `lg` 40px for the one primary CTA of a
  page. `xl` is for hero marketing only.
- Variants: `default` (black, the one main action), `secondary` (soft gray,
  everything else), `outline` (rare, when sitting on gray), `ghost`
  (toolbar/icon actions), `destructive` (confirming a destructive act only;
  a list's "Revoke" is outline + red text).
- Inputs, selects and textareas: 36px, `rounded-[10px]`, alpha border,
  blue border + soft halo on focus. 16px text on phones (iOS zoom), 14px
  from `md`.
- Use `Field` (label above, hint/error below) inside a `FieldGroup`
  (max-w-md, 20px gaps), with `FormActions` at the end.
- Preferences are `SettingsRow`s (title + description left, control right,
  hairlines between), never a form with a Save button per toggle.
- Choice among a few options → `SegmentedControl` or radio cards, not a
  select. Long lists → search + list, not a giant grid.

## Lists and rows

- A row is `flex items-center gap-3 rounded-xl px-3 py-2.5
  hover:bg-muted/70` with a 36–40px leading thumbnail or icon badge, title
  `text-sm font-medium`, meta `text-[13px] text-muted-foreground`, and a
  trailing value or chevron.
- Selected row: `bg-muted` plus a check, not a thick border.

## Empty, loading, error

- `EmptyState` / `StatusScreen` from `components/ui/page.tsx`: icon badge,
  one-line title, one-line description, one action.
- Loading: skeletons shaped like the content, or `DottedSpinner` with a
  sentence. No full-page spinners where layout is known.

## Motion

- Interactions ≤ 200ms. `ease-enter` (0.19,1,0.22,1) in, `ease-exit` out.
- Page entrance is `.mz-enter`: a 4px fade-rise, nothing that bounces.
- Popovers/menus scale from 0.95 with opacity.
- Don't animate list additions, hovers or anything frequent.

## Interactions

- Inputs live in a `<form>` so Enter submits. Disable submit while pending
  and use `loading` on the button.
- Optimistic updates where it's safe; inline feedback near the control.
- Every icon-only button has an `aria-label`.
