# Materialize Design System

Reference for UI polish and interaction design. Synthesized from Raphael Salaja, Rauno Freiberg, shadcn, Jakub Krehel, and Benji Taylor.

## Typography

- Antialiased rendering: `-webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility`
- Weights: 400 body, 500-600 subheadings, 700 headings. Never below 400.
- `tabular-nums` on prices, counters, tables
- Headings: `leading-tight` (~1.2). Body: `leading-relaxed` (~1.6)
- Custom `::selection` with `hsl(var(--primary) / 0.2)`

## Spacing

- Strict 4px base: `gap-1(4) gap-2(8) gap-3(12) gap-4(16) gap-6(24) gap-8(32) gap-12(48) gap-16(64)`
- Radius scale: `rounded(4px)` inputs, `rounded-lg(8px)` cards, `rounded-xl(12px)` dialogs, `rounded-full` pills
- Padding on items (not gap on containers) so full row is clickable

## Color & Contrast

- Multi-layer shadows:
  ```
  shadow-[0px_0px_0px_1px_rgba(0,0,0,0.06),0px_1px_2px_-1px_rgba(0,0,0,0.06),0px_2px_4px_0px_rgba(0,0,0,0.04)]
  ```
- Text hierarchy: primary 93%, secondary ~60% (`text-muted-foreground`), muted ~45%
- Focus rings via `ring-2 ring-offset-2 ring-primary` (respects border-radius)
- Always use semantic tokens: `border-border`, `text-muted-foreground`, `bg-muted` — never hardcode opacity

## Motion

**Core rule: Cap interaction animations at 200ms. Scale must be proportional to trigger size.**

- Enter: `opacity 0→1, translateY 8px→0, blur 4px→0` over 450ms spring
- Exit: `translateY -12px, opacity 0, blur 4px` — subtler than enter
- CSS transitions: `cubic-bezier(0.2, 0.8, 0.2, 1)`
- Duration map: 100ms color, 150ms background, 200ms transforms, 250ms opacity/position
- **Don't animate**: frequent hovers, list additions, anything low-novelty
- **Litmus test**: "This feels really nice" not "cool animation"

## Components

- Composition over configuration — small pieces, not mega-props
- Own the code — modify shadcn directly, don't wrap with overrides
- Every interactive element: `aria-label` if icon-only, proper focus states
- Icon swaps (copy→check): `opacity 0→1, scale 0.8→1, blur 4px→0`

## Interactions

- Inputs in `<form>` for Enter-key. Min 16px font on mobile inputs (prevents iOS zoom)
- Toggles apply immediately. Disable buttons after submission
- Dropdowns on `mousedown` not `click`
- Optimistic updates: mutate UI instantly, rollback on error
- Position feedback near trigger (inline checkmark, highlight on field)
- `pointer-events-none` on decorative overlays
- `will-change: transform, opacity` only during active animation
