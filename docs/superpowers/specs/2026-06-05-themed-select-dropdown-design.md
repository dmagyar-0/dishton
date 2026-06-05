# Themed `Select` dropdown — design

**Date:** 2026-06-05
**Status:** Approved

## Problem

The shared `Select` primitive (`src/ui/primitives/Select.tsx`) wraps a native
`<select>`. Only the *trigger* is themed (`appearance-none`, dark surface). When
opened, the option list is drawn by the browser/OS — a white box with a blue
highlight — which CSS cannot theme cross-browser. Against Dishton's dark
"Editorial Pantry" palette the popup looks foreign. Reported on the profile
"Recipe language" picker; the same root cause affects every native `<select>`.

The design system already proves the target look: `Combobox`
(`src/ui/primitives/Combobox.tsx`) renders a fully custom popup using the right
tokens. And `docs/03-design-system.md` calls the native `Select` a *"fallback
only when complexity demands custom"* — so a themed custom dropdown is the
sanctioned escalation.

## Decision

- **Approach:** new themed `Select` primitive (no new dependencies) — not Radix,
  not the searchable `Combobox`.
- **Scope:** replace the shared primitive so *all* native selects get the themed
  popup: profile language picker, recipe-sidebar `LanguageToggle`, household
  Leave/Transfer dialog.

## Design

### New `Select` primitive

A "select-only combobox" (WAI-ARIA APG pattern): a `<button role="combobox">`
trigger plus a `<ul role="listbox">` popup we render and style. API mirrors the
sibling `Combobox`:

```ts
type SelectOption = { value: string; label: string; disabled?: boolean };
type SelectProps = {
  options: SelectOption[];
  value?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  ariaLabel?: string;
  className?: string;
};
```

### Look

- **Trigger:** keep today's exact styling so nothing on the page shifts —
  transparent bg, 2px `cream-line` bottom border, `focus:border-saffron`,
  absolutely-positioned `ChevronDown`. Shows the selected option's label, or
  `placeholder` in `text-ink-muted`. Left-aligned (`text-left`, `pr-8`).
- **Popup:** reuse `Combobox`'s treatment verbatim — `absolute z-10 mt-1
  max-h-60 w-full overflow-auto py-1`, `bg-paper-2 border border-cream-line
  shadow-press rounded-[var(--radius-md)]`. Rows: `px-3 py-2 text-ink`; active →
  `bg-paper`; selected → `font-medium text-saffron-ink`; disabled →
  `text-ink-muted cursor-not-allowed`.

### Behavior / a11y

- Open via click, or Enter/Space/↓/↑ when focused. Closed→open seeds the active
  index to the currently selected option (else 0).
- Open: ↑/↓ move active, Home/End jump, Enter/Space select active + close, Esc
  closes without change, Tab closes. Type-ahead: typed characters (≈500ms
  buffer) jump to the first option whose label starts with the buffer.
- `aria-activedescendant` on the trigger points at the active option; focus
  stays on the trigger (no roving tabindex). `aria-expanded`,
  `aria-controls`, `aria-haspopup="listbox"`. Options carry `role="option"`,
  `aria-selected`, `aria-disabled`.
- Click-outside closes (mousedown listener, as in `Combobox`).
- Active option scrolls into view when navigating.
- `<button>` is a labelable element, so the existing `<label htmlFor>` on the
  profile and dialog selects keeps providing the accessible name; `ariaLabel`
  covers the `LanguageToggle` case.
- Visible saffron focus indicator retained. Popup downward-only (matches
  `Combobox`; no flip logic — YAGNI).

### Call-site updates

1. `src/routes/profile.tsx` — `LANGUAGE_OPTIONS` items become `{ value, label }`;
   pass `options={LANGUAGE_OPTIONS}`, `value`, `onValueChange`, `id`, `disabled`.
2. `src/ui/recipe/LanguageToggle.tsx` — map `{ code, native }` →
   `{ value: code, label: '`native` (`code`)' }`; pass `ariaLabel`, `value`,
   `onValueChange`.
3. `src/ui/household/dialogs/LeaveOrTransferDialog.tsx` — build `options` with the
   leading `{ value: '', label: '—' }` then members; `value`, `onValueChange`,
   `id`, `disabled`.

### Tests & docs

- Rewrite `src/ui/primitives/Select.test.tsx`: renders combobox with accessible
  name + selected label; opens on click listing `role="option"`; selecting calls
  `onValueChange` and closes; keyboard (↓ opens/moves, Enter selects, Esc
  closes); `disabled` doesn't open; placeholder shown when value matches nothing.
- Update `src/ui/recipe/LanguageToggle.test.tsx` for the new interaction (no
  native `selectOptions`).
- Update the `Select` row in `docs/03-design-system.md` — it is now a custom
  themed listbox, not native.
- No migration: zero schema change.

### Validation

Run the `validating-features-visually` skill before claiming done — Playwright
through signup + the profile language flow + adjacent surfaces, with the menu
**open**, at desktop and mobile viewports.

## Implementation order

1. (TDD) Write `Select.test.tsx` against the new API → red.
2. Implement `Select.tsx` → green; refactor.
3. Swap the three call sites; update `LanguageToggle.test.tsx`.
4. Update `index.ts` exported types and the design-system doc row.
5. `pnpm typecheck && pnpm lint`; run the affected test files.
6. Visual validation; then commit + push.

## Non-goals

- No Radix dependency, no searchable filtering, no popup flip/portal logic, no
  native-form `name`/hidden-input submission (no call site needs it).
