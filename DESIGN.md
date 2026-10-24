# Nana — Signal & Paper design system

## Overview

**Signal & Paper** is a flat editorial workspace: bone paper and charcoal ink, one ultramarine signal, mono metadata, and rules instead of decorative cards. The light theme is the same ledger at noon, not a different app.

The category default this refuses: near-black glass admin panels, stacked gradients, grain overlays, glowing borders, and serif “editorial” theatre. Signal & Paper uses structure — hairlines, alignment, and one accent — for hierarchy.

## Colour

All colour is tokenised in `src/index.css` and exposed to Tailwind through `@theme inline`. Use the semantic utility, not a raw colour.

| Token | Dark | Light | Use |
| --- | --- | --- | --- |
| `canvas` | `#141518` | `#f4f1e9` | App ground |
| `canvas-deep` | `#0f1012` | `#eae6dc` | Sidebar, public bar, footer, deep wells |
| `surface` | `#1b1d21` | `#fbfaf6` | Panels, dialogs, menus |
| `surface-raised` | `#232529` | `#ffffff` | Hover rows, floating menus, popovers |
| `surface-sunken` | `#101114` | `#ede9e0` | Inputs, wells, code, active row tint |
| `line` | `rgb(236 237 239 / 0.12)` | `rgb(26 27 30 / 0.12)` | Hairline rules |
| `line-strong` | `rgb(236 237 239 / 0.36)` | `rgb(26 27 30 / 0.5)` | Emphasis borders, input borders, focus support |
| `ink` | `#ecedef` | `#1a1b1e` | Primary text |
| `ink-secondary` | `#a8abb2` | `#53565c` | Body and supporting text |
| `ink-muted` | `#8a8d94` | `#63656c` | Labels, metadata, placeholders |
| `signal` | `#7483ff` | `#2b3fd1` | Primary action, active nav, progress, one accent |
| `signal-strong` | `#95a2ff` | `#1f2fa6` | Hover/pressed signal |
| `signal-soft` | `rgb(116 131 255 / 0.14)` | `rgb(43 63 209 / 0.1)` | Active rows, selected tags, tinted callouts |
| `on-signal` | `#0b0d12` | `#ffffff` | Text/icon on a filled signal surface |
| `warning` | `#d9a84e` | `#7a4b00` | Warnings, due-soon metadata |
| `warning-soft` | `rgb(217 168 78 / 0.14)` | `rgb(122 75 0 / 0.1)` | Warning surfaces |
| `success` | `#57c08a` | `#17683f` | Success, completed counts |
| `success-soft` | `rgb(87 192 138 / 0.14)` | `rgb(23 104 63 / 0.1)` | Success surfaces |
| `danger` | `#f08a80` | `#b3261e` | Destructive actions, errors, overdue dates |
| `danger-soft` | `rgb(240 138 128 / 0.14)` | `rgb(179 38 30 / 0.1)` | Error surfaces |
| `on-danger` | `#1a0b09` | `#ffffff` | Text/icon on a filled danger surface |
| `scrim` | `rgb(0 0 0 / 0.62)` | `rgb(20 21 24 / 0.38)` | Modal and sheet backdrop |

`--float-shadow` is the only elevation token:

| Theme | Value |
| --- | --- |
| Dark | `0 24px 60px -24px rgb(0 0 0 / 0.55)` |
| Light | `0 24px 60px -28px rgb(20 21 24 / 0.22)` |

Rules:

- **One accent per surface.** Signal is action, active state, focus, progress, and selection. Warning/success/danger are status only.
- **Filled signal uses `text-on-signal`.** In dark it is near-black; in light it is white. Never assume white works on both.
- **No gradients, grain, glass, or glow.** Flat fills and hairlines carry the surface.
- **No raw Tailwind colour families.** `gray`, `stone`, `blue`, `amber`, etc. are outside the system.
- **No `dark:` / `light:` variants.** Theme is a `data-theme` value and the tokens flip.
- **Borders are one hairline by default.** `line-strong` is for inputs, focus-adjacent state, and deliberate emphasis, never decoration.

## Type

| Role | Family | Treatment |
| --- | --- | --- |
| Display | Schibsted Grotesk variable, 400–900, self-hosted | Page titles, dialog/sheet titles, section headings, board titles, public reading titles. Semibold, tight leading, slight negative tracking. |
| UI | Schibsted Grotesk variable | Controls, body, navigation, labels. |
| Mono | JetBrains Mono 400/500, self-hosted | Eyebrows, metadata, counts, ids, URLs, code, keyboard hints. |

`--font-display` and `--font-sans` both resolve to Schibsted Grotesk. “Display” is a role, not a second typeface. There is no serif in the product.

Font files live in `src/assets/fonts/` and are served from the app origin; CSP is `font-src 'self'`. Keep the OFL licence files beside the font files. Do not add a Google Fonts link or a remote font host.

Scale:

- Page title: 28px mobile / 32px desktop, weight 600, line-height 1.1, tracking `-0.02em`.
- Dialog title: 20px semibold. Sheet title: 18px. Section heading: 20px. Empty-state title: 18px.
- Body: 13–15px, relaxed leading. Assistant answers: 15px / 1.7. User messages: 15px / 1.6.
- Metadata: 10px JetBrains Mono, weight 500, uppercase, `0.08em` tracking, `ink-muted`. Use the shared `.eyebrow` / `.meta` utility.
- Labels: 13px medium, sentence case. Hints: 12px muted. Optional marker: 11px.

Hierarchy comes from size, spacing, and rules. Do not add a third weight or a display serif to create emphasis.

## Shape and surface

- Radii: controls **6px** (`rounded-control`), panels **10px** (`rounded-panel`), mobile sheets **16px** (`rounded-sheet`).
- Ledger rows and kanban task rows are square and separated by a single hairline. They are not floating cards.
- Surfaces are flat. `surface-raised` is a hover/menu state, not a permanent second layer.
- The only shadow is `shadow-float`, used on overlays: dialogs, sheets, menus, toasts, and popovers. Nothing in the page body carries a shadow.
- No panel top highlight, inner glow, gradient wash, or textured background.
- Focus is `outline: 2px solid var(--signal); outline-offset: 2px`, or a 2px signal ring on inputs. Never remove focus visibility.
- Signal details are structural: a 2px active rail, a 3px progress fill, a 2px insertion line, a 3px toast accent bar, and a thin running-tool rule.

## Layout

- Content pages use 16px mobile / 24–32px desktop gutters and a masthead with a single bottom rule.
- The board index is a ledger: Board, Progress, Open, Updated on desktop; stacked rows on mobile.
- The board detail is four fixed columns on desktop, separated by 1px rules; mobile is a horizontal snap row.
- The board archive is a ledger with restore/delete actions aligned right on desktop.
- Chat is a centred 720px reading column. Assistant answers are bounded to 68ch; user messages are right-aligned and capped at 75–85% of the column.
- Settings uses a 12rem left rail (`lg:w-48`) on desktop and a two-column tab grid on mobile; the content container is `max-w-6xl`.
- The collapsed desktop rail is 80px. The mobile bottom bar has five slots: Menu, Timeline, Boards, Folders, Chat; Settings opens from the profile menu.
- The editor, board, and folder views fill the available height; their internal panes scroll, not the page.
- Public pages use the same paper ground and reading measure, without app chrome.

## Motion

- App durations: 140–260ms. Standard easing is `ease-out` or the house `cubic-bezier(0.22, 1, 0.36, 1)`.
- Dialogs: 220ms fade + 10px rise + scale from 0.985; exit 160ms. Sheets: 260ms rise; exit 180ms.
- Menus: 140ms pop from 0.97 with a 2px lift.
- Desktop route content: 260ms, 4px rise. Mobile route change: 240ms, 14px lateral slide in the route order.
- Public content enters over 420ms; attachment items enter from 8px with a 0.99 scale.
- Hover changes colour and border only, never size. Dragging a task uses 40% opacity and a 2px signal insertion line.
- Respect `prefers-reduced-motion`; `src/index.css` reduces all animation and transition durations to `0.01ms`.

## Components

The primitives live in `src/components/ui/`; `Toast` and `ToastHost` live in `src/components/`.

| Component | Contract |
| --- | --- |
| `Button` | Variants `primary` (signal fill), `secondary` (border + raised surface), `ghost`, `danger` (danger fill), `link`. Sizes `sm` 32px, `md` 40px, `lg` 44px. Loading spinner replaces the leading icon. |
| `IconButton` | Square 32/36/44px; `label` is required and becomes `aria-label` and `title`. Default variant is `ghost`. |
| `Field`, `Input`, `Textarea`, `Select` | Label + optional marker + hint + error. Inputs use `surface-sunken`, a strong hairline, and a signal focus ring. `Select` owns its chevron. |
| `Switch`, `Checkbox`, `SegmentedControl` | Native semantics, 150ms state change, signal for on/selected. `SegmentedControl` uses a raised active pill inside a sunken track. |
| `Card`, `SectionHeading` | `Card` is a 10px panel with a hairline. `SectionHeading` renders a 20px display title, description, and actions; its `eyebrow` prop is accepted but not rendered. |
| `Dialog` | Portalled, focus-trapped, Escape/backdrop close, scroll lock, nested stack, exit animation. Sizes `sm`/`md`/`lg`/`xl`/`full`. Mobile becomes a bottom-anchored sheet. Only overlay with `shadow-float`. |
| `ConfirmDialog` | Built on `Dialog`; `tone="danger"` for destructive actions; verb confirm label. |
| `Sheet` | Mobile bottom sheet with drag handle, scrim, Escape, focus restore, safe-area padding. |
| `MenuSurface`, `MenuItem` | Fixed floating menu, outside-click + Escape, 140ms pop, `shadow-float`; `MenuItem` supports a danger tone and a hint. |
| `PageHeader` | Display title, optional description, right-aligned actions, single bottom rule. No eyebrow is rendered. |
| `EmptyState` | Editorial hairline block, optional compact padding, title, description, actions. The `icon` prop is accepted but intentionally not rendered. |
| `Badge` | Tones `neutral`, `signal`, `warning`, `success`, `danger`, `outline`; optional dot. |
| `Spinner` | Signal-topped ring, 20px default; pass a `label`. |
| `Avatar` | Image or initial fallback on a raised surface. |
| `Toast` | Raised panel, 3px left accent, mono type label (`Error`, `Success`, `Notice`), icon, dismiss. |

Rules:

- No bespoke modal shells. A new modal is a `Dialog` (or `Sheet` on touch) with a title, optional description, and a footer of `Button`s.
- Destructive confirmation always uses `ConfirmDialog` with `tone="danger"` and a verb label (“Move to trash”, “Delete forever”). Never a green destructive button.
- Icon-only buttons require `label`.
- Empty states explain the next action; they do not blame the user.
- Do not put a shadow on a page-level card. Shadows belong to overlays.

## Board

### Index ledger

`/board` is the index, not a card grid.

- Masthead: `Boards`, a one-line description, `Archived`, and `New board`.
- A mono summary rule reads `NN boards · NN open · NN done`.
- Desktop columns: Board (name + description), Progress (3px rule + `done/total`), Open, Updated. The header row is 10px mono uppercase.
- Rows are full-width buttons separated by hairlines. Hover/focus adds `surface-sunken` and a 2px signal rail on the left.
- Mobile stacks progress, open count, and updated date under the name.
- Empty boards show `No tasks`; missing descriptions show `No description`.
- The archive page uses the same ledger language with restore and `Delete forever` actions.

### Kanban detail

`/board/:boardId` is the working board.

- A back link (`All boards`), display title, description, and a mono `NN open · NN done` line.
- Column headers carry `01`–`04`, the label, a mono count, and an add button. `In progress` is the signal column and keeps a signal top rule.
- Task rows: 14px medium title, one-line muted excerpt, then 10px mono metadata — priority code (`P0`–`P3`), due date (danger when overdue), linked note, up to two labels. Done rows are muted and struck through.
- Desktop shows four columns divided by vertical hairlines. Mobile snaps one column at a time.
- Drag state is 40% opacity; the insertion line is 2px signal. A filtered board pauses dragging.
- Empty columns show the column hint (“Someday, unsorted”, “Committed, not started”, “Actively moving”, “Finished work”).
- The board edit dialog owns archive. The archive confirmation says the board and its tasks leave the index and that nothing is deleted.
- The archive page's permanent delete is a danger confirmation that names the task count and states that source notes stay in the library.

### Add to board

The picker is a `Dialog` opened from one root host. It lists active boards as ledger rows with `NN open · NN total`, marks a board that already holds this note as `Already here`, and offers `Create a board` inline. The board detail's `Import note` is a separate, board-scoped dialog: search notes, show `On board` for existing ones, and import into the open board.

## Chat

- Empty state: `Ask your notes.` at 28px, one supporting sentence, then prompt rows with a trailing arrow that turns signal on hover. No illustration, no cards.
- The composer is a single bordered shell with a textarea, a mono `Enter to send · Shift+Enter` hint, and a small signal send button.
- Assistant answers are document text: 15px / 1.7, max 68ch, Markdown-rendered, with a blinking signal caret while streaming. They are not bubbles.
- User messages are right-aligned in a `surface-sunken` block with a hairline, capped at 85% (75% on desktop).
- Tool activity is one quiet line of 10px mono uppercase above the answer. While running it reads “Looking through your workspace…” with a 1px signal rule; afterwards it summarizes what was read.
- Reasoning is a collapsible details block with a 13px muted body and a left rule. It is open while thinking and collapses when the answer arrives.
- Conversation history is a right-side panel: 16rem on desktop, a 18rem overlay on mobile, with new-chat and delete actions.
- There are no attachment chips, document pickers, or source cards. Chat reads through tools; the answer must cite note or board titles in its own text.
- A finished reply has copy and regenerate icon buttons; a “New messages” pill appears when the reader has scrolled away from the bottom.

## Voice

- Concrete, calm, second person. “Archive this board?” not “Are you sure you want to proceed?”.
- Buttons are verbs: “Save sharing”, “Create task”, “Restore version”, “Delete forever”.
- Labels are nouns: “Public access”, “Attachments”, “Start page”, “Progress”.
- Board copy is plain about consequence: “Nothing is deleted — restore it any time from Archived boards.”
- No exclamation marks, no “simply”, no “Oops”.
- Dates: relative for the last day (“2h ago”), short absolute after (“Oct 23”), with a year once outside the current year.
- Never call the mascot a fox. It is a rabbit holding a notebook.

## Theme

`src/lib/theme.ts` owns the preference: `system`, `dark`, or `light`, stored under `nana-theme`. `initTheme()` runs before React mounts; it sets `data-theme` on `<html>`, updates `color-scheme`, and updates the `theme-color` meta (`#141518` dark, `#f4f1e9` light). Utilities read the tokens, never the preference. The profile menu has a quick toggle; Settings → Preferences has the three-tile picker.

## Do not

- Use raw hex values in components, or `gray`/`stone`/`blue`/`amber` Tailwind families.
- Use `dark:` or `light:` variants; the theme is a data attribute with semantic tokens.
- Add gradients, grain, glass blur, glow, or a serif face.
- Add a second accent. Signal is the action colour; warning, success, and danger are status only.
- Put a shadow on a page card. Only overlays use `shadow-float`.
- Add another modal, button, input, or card implementation beside the primitives.
- Use more than one display weight to create hierarchy; use size, space, and rules.
- Add an eyebrow back to `PageHeader` or an icon back to `EmptyState` without a design decision.

## Related docs

- [`PRODUCT.md`](PRODUCT.md) — audience, product truth, and surfaces.
- [`docs/frontend.md`](docs/frontend.md) — routes, state, board/chat implementation.
- [`docs/ai.md`](docs/ai.md) — chat tools and tool-activity contract.
- [`src/index.css`](src/index.css) — canonical token values and global motion.
