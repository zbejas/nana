# Nana — design system

**Ember & Ink.** A writer's desk after dark: warm ink grounds, cream paper type, and a low ember accent drawn from the mascot. The light theme is the same desk at noon, not a different app.

The category default this refuses: near-black glass admin panels with one neon accent and glowing borders.

## Colour

All colour is tokenised in `src/index.css` and exposed to Tailwind through `@theme inline`. Use the semantic utility, not a raw colour.

| Token | Night | Day | Use |
| --- | --- | --- | --- |
| `canvas` | `#15100d` | `#f3ece0` | App ground |
| `canvas-deep` | `#100c0a` | `#e9dfcd` | Sidebar, public bar, footer |
| `surface` | `#1e1712` | `#fbf6ea` | Cards, dialogs, panels |
| `surface-raised` | `#271e18` | `#fffaf1` | Hover, menus, popovers |
| `surface-sunken` | `#130f0c` | `#ece2d2` | Inputs, wells, code |
| `line` | cream 10% | ink 13% | Hairline borders |
| `line-strong` | cream 20% | ink 24% | Emphasis borders |
| `ink` | `#f3e8d7` | `#241a13` | Primary text |
| `ink-secondary` | `#c3b09a` | `#5b4a3b` | Body and supporting text |
| `ink-muted` | `#907d69` | `#8a7764` | Labels, placeholders, metadata |
| `ember` | `#e8823f` | `#bd5320` | Primary action, active nav, accent |
| `ember-strong` | `#f59a5c` | `#a24315` | Hover |
| `ember-soft` | ember 14% | ember 10% | Active rows, selected cards, tinted panels |
| `brass` | `#d6ad6b` | `#8a6423` | Secondary emphasis, warnings |
| `sage` | `#9ab98c` | `#4f7345` | Success |
| `danger` | `#e07362` | `#ad3b2b` | Destructive actions |

`on-ember` and `on-danger` are the text colours for filled accent buttons. Never put white on ember in the night theme; use `text-on-ember`.

Atmosphere is two fixed layers behind the app: a warm radial glow (`body::before`) and a paper grain (`body::after`), both theme-aware and disabled behind public pages.

## Type

| Role | Family | Treatment |
| --- | --- | --- |
| Display | `--font-display`: Iowan Old Style / Palatino / Georgia stack | Page titles, dialog titles, note titles, public reading titles. Tight leading, slight negative tracking. |
| UI | `--font-sans`: system stack | Controls, body, navigation, labels. |
| Mono | `--font-mono`: system mono | URLs, code, token values. |

Rules:

- Every route opens with an `eyebrow` (11px, uppercase, 0.14em tracking, muted) and a serif `h1` at roughly 28–32px.
- Body copy is 13–15px with relaxed leading; metadata is 11–12px.
- Labels are sentence case and 13px medium. Eyebrows are the only uppercase text.
- No bold sans headings. Hierarchy comes from the serif display face and spacing, not weight.

## Shape and surface

- Radii: controls 10px (`rounded-control`), panels 16px (`rounded-panel`), mobile sheets 20px.
- Borders are one hairline (`border-line`); strong borders are for focus and selected states, never decoration.
- Panels carry a subtle top highlight (`panel-hairline`) and a deep, soft shadow (`shadow-panel` / `shadow-float`). No glass blur on app panels; blur is reserved for scrims and the sticky app bar.
- The sidebar is a darker leather rail, not a floating card.

## Layout

- Content pages use a centred container (max 6xl) with 16px mobile / 24–32px desktop gutters and a masthead at the top.
- Board, folder view, and the editor fill the available height; columns and panes scroll internally.
- Settings uses a left rail on desktop and a two-column tab grid on mobile.
- The collapsed desktop rail is 80px and always available; the mobile bottom bar has five destinations.

## Components

The primitives live in `src/components/ui/`:

| Component | Contract |
| --- | --- |
| `Button` / `IconButton` | `primary`, `secondary`, `ghost`, `danger`, `link`; sizes `sm/md/lg`; loading state. |
| `Field`, `Input`, `Textarea`, `Select` | Label + hint + error. `Select` includes its own chevron. |
| `Switch`, `Checkbox`, `SegmentedControl` | Accessible state; ember for on/selected. |
| `Card`, `SectionHeading` | The only panel shell. |
| `Dialog` | Portalled, focus-trapped, ESC/backdrop close, scroll lock, nested stack, exit animation. |
| `ConfirmDialog` | Built on `Dialog`; `tone="danger"` for destructive actions. |
| `Sheet` | Mobile bottom sheet for menus and pickers. |
| `MenuSurface`, `MenuItem` | Floating menus with outside-click and ESC. |
| `PageHeader`, `EmptyState`, `Badge`, `Avatar`, `Spinner` | Shared page and feedback vocabulary. |
| `Toast` | Accent bar, tone icon, plain-language label. |

Rules:

- No bespoke modal shells. A new modal is a `Dialog` (or `Sheet` on touch) with a title, optional description, and a footer of `Button`s.
- Destructive confirmation always uses `ConfirmDialog` with `tone="danger"` and a verb label ("Move to trash", "Delete task"). Never a green destructive button.
- Icon-only buttons require `label`.
- Empty states explain the next action; they do not blame the user.

## Motion

- 150–220ms, `ease-out` or the house `cubic-bezier(0.22, 1, 0.36, 1)`.
- Dialogs fade and rise 10px; sheets rise from the bottom; menus pop 3%.
- Page transitions are a 4px rise on desktop and a 14px lateral slide on mobile.
- Hover changes colour and border, never size. Drag state is 35% opacity with an ember insertion line.
- Respect `prefers-reduced-motion`; the global stylesheet disables animation when requested.

## Voice

- Concrete, calm, second person. "Move this note to trash?" not "Are you sure you want to proceed?".
- Buttons are verbs: "Save sharing", "Create task", "Restore version".
- Labels are nouns: "Public access", "Attachments", "Start page".
- No exclamation marks, no "simply", no "Oops".
- Dates: relative for the last week ("2h ago"), short absolute after ("Oct 23").
- Never call the mascot a fox. It is a rabbit holding a notebook.

## Theme

`src/lib/theme.ts` owns the preference: `system`, `dark`, or `light`, stored under `nana-theme`. `initTheme()` runs before React mounts; it sets `data-theme` on `<html>` and updates the `theme-color` meta. Utilities read the tokens, never the preference. The profile menu has a quick toggle; Settings → Preferences has the three-tile picker.

## Do not

- Use raw hex values in components, or `gray`/`stone`/`blue` Tailwind families.
- Use `dark:` or `light:` variants; the theme is a data attribute with semantic tokens.
- Add another modal, button, input, or card implementation beside the primitives.
- Use more than one accent per surface. Ember is the action colour; brass is informational; sage is success.
- Put a serif face on body copy or a control.
