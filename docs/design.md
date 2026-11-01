# Nana — Graphite design system

## Overview

**Graphite** is a quiet, precise workspace: paper and graphite neutrals, one restrained ember accent, flat panels, and a single sans voice. The interface should feel like a well-made desk: the writing leads, the chrome recedes, and every surface shares the same geometry. Light is daylight paper; dark is the same desk under a low lamp.

The category defaults Graphite refuses: blue-violet “AI” gradients, near-black glass dashboards, orange-everywhere brand surfaces, serif editorial theatre, and a different typeface for every role. Hierarchy comes from scale, tone, spacing, and one hairline — not from decoration.

The signature is the **restrained ember**. It marks primary action, focus, selection, and progress, and almost nothing else. Navigation, cards, metadata, tags, and page chrome are neutral. Never introduce a second accent family.

## Colour

All colour is tokenised in `src/index.css` and exposed to Tailwind through `@theme inline`. Use the semantic utility, never a raw colour.

| Token | Dark | Light | Use |
| --- | --- | --- | --- |
| `canvas` | `#0c0c0d` | `#faf9f7` | Page ground |
| `canvas-deep` | `#080809` | `#f2f1ee` | Sidebar, mobile nav, footer |
| `surface` | `#131315` | `#ffffff` | Panels, cards, dialogs, side panels, menus, inputs |
| `surface-raised` | `#1b1b1e` | `#f7f6f3` | Hover rows, selected cards, popovers |
| `surface-sunken` | `#0f0f10` | `#f3f2ef` | Wells, nested chips, column lanes, stats |
| `line` | `rgb(255 255 255 / 0.07)` | `rgb(26 26 24 / 0.08)` | Default hairline |
| `line-strong` | `rgb(255 255 255 / 0.18)` | `rgb(26 26 24 / 0.18)` | Emphasis borders, hover support |
| `ink` | `#f5f5f4` | `#1a1a18` | Primary text |
| `ink-secondary` | `#a3a39e` | `#52524e` | Body and supporting text |
| `ink-muted` | `#8a8a84` | `#6b6b65` | Metadata, labels, placeholders |
| `signal` | `#ff7a54` | `#b7431e` | Text links, focus, icons, selection marks |
| `signal-strong` | `#ff9b7c` | `#943314` | Hover and pressed text accent |
| `signal-bright` | `#ff7048` | `#b7431e` | Primary action fills, progress, selected days |
| `signal-bright-strong` | `#ff8a66` | `#9c3718` | Hover and pressed action fill |
| `signal-soft` | `rgb(255 112 72 / 0.12)` | `rgb(183 67 30 / 0.08)` | Selected rows, soft callouts |
| `on-signal` | `#1a0b06` | `#ffffff` | Text and icons on `signal-bright` |
| `warning` | `#e3b25f` | `#855600` | Warnings, private markers, due-soon |
| `success` | `#74c69d` | `#1f6b45` | Done counts, healthy status |
| `danger` | `#ff7b72` | `#b42318` | Destructive actions, errors, overdue |
| `scrim` | `rgb(0 0 0 / 0.66)` | `rgb(20 20 18 / 0.36)` | Modal and sheet backdrop |

`warning-soft`, `success-soft`, `danger-soft`, `on-danger`, `scrim`, and `float-shadow` follow the same pattern and are defined once in `src/index.css`.

### Cover tokens

Auth, onboarding, reset, and email confirmation use a theme-invariant cover so the first screen keeps the same deep ground in both themes.

| Token | Value | Use |
| --- | --- | --- |
| `cover` | `#09090a` | Auth cover ground |
| `cover-surface` | `#121214` | Reserved for raised cover fields |
| `cover-line` | `rgb(255 255 255 / 0.08)` | Cover hairlines |
| `cover-ink` | `#f5f5f4` | Cover headings and body |
| `cover-muted` | `#9b9b95` | Cover supporting text |
| `cover-signal` | `#ff7a54` | Reserved for the product mark |

Rules:

- **One accent family per surface.** Ember is action, focus, selection, and progress. Warning, success, and danger are status only.
- **Filled ember uses `signal-bright` with `text-on-signal`.** White on the light fill is 5.48:1; near-black on the dark fill is 7.0:1. Never assume white works in both themes.
- **No raw Tailwind colour families.** `gray`, `stone`, `zinc`, `blue`, `amber`, and `orange` are outside the system, even when they look close.
- **No `dark:` / `light:` variants.** Theme is a `data-theme` value and the tokens flip.
- **No gradients, grain, glass, glow, or serif faces.** Flat fills, tonal panels, and hairlines carry the surface.
- **Light `ink-muted` stays dark enough for small text.** `#6b6b65` on the light canvas is 5.1:1. Do not lighten it for softness.
- **Status dots are the only permanent colour in a board lane.** Backlog is `ink-muted`, Next up is `warning`, In progress is `signal`, Done is `success`.

## Type

| Role | Family | Treatment |
| --- | --- | --- |
| Interface | Geist variable, 100–900, self-hosted | Everything: titles, controls, body, navigation, labels, data. |
| Code | Geist Mono variable, self-hosted | Code blocks, ids, URLs, and keyboard hints inside prose. Nothing in the interface chrome. |

One family carries the whole product. There is no display face, no separate label face, and no mono metadata. Numbers in UI use `tabular-nums` in Geist. Font files live in `src/assets/fonts/` and are served from the app origin; CSP is `font-src 'self'`. Keep the OFL licence file beside the font files. Do not add a Google Fonts link or a remote font host.

Scale:

- Page title: 28px mobile / 34px desktop, weight 600, line-height 1.08, tracking `-0.032em`.
- Auth hero: 38px mobile / 48px desktop, weight 600, line-height 1.02, tracking `-0.035em`.
- Section heading: 17px semibold, tracking `-0.015em`. Dialog title: 18px. Sheet and side-panel title: 17px. Inline form title: 16px. Empty-state title: 17px.
- Body: 13.5–14px. Assistant answers and note prose: 14.5–15px / 1.75.
- Labels and buttons: 12.5–13px medium. Metadata and hints: 11–12px.
- `.eyebrow` and `.meta` are 12px sans, sentence case. Section labels are 11.5px medium.

Do not set interface labels in mono, uppercase, or wide tracking. Mono exists for code and identifiers only.

## Shape and surface

- Radii: controls **6px** (`rounded-control`), panels **10px** (`rounded-panel`), mobile sheets **16px** (`rounded-sheet`).
- Route content is full bleed beside the sidebar. The sidebar’s 1px right rule is the only divider; do not wrap Timeline, Folders, Chat, Settings, or the editor in an outer card, border, radius, or inset.
- Every authenticated route uses `PageShell` for one shared page field, max **1280px** (reading 820px, wide 1600px), centered, with 20/32/48px gutters.
- Panels are flat. `surface-raised` is a hover/menu state, not a permanent second layer.
- The only shadow is `shadow-float`, used on overlays: dialogs, sheets, side panels, menus, toasts, and the install banner. Nothing in the page body carries a shadow.
- Focus is `outline: 2px solid var(--signal); outline-offset: 2px`, or a 1px ember border with a 4px `signal/10` ring on inputs.
- Ember details are structural but rare: the primary action, the active icon, the focused input, the progress fill, the selected calendar day, and a drag insertion line.

## Layout and shell

### Desktop shell

- The expanded sidebar is 288px by default, resizable 240–420px. The collapsed rail is **64px**.
- The content inset is exactly the sidebar width (or 64px for the rail). There is no extra gap or frame around the route content. `src/App.tsx`, `src/components/Footer.tsx`, and `src/components/sidebar/CompactSidebar.tsx` share these constants; change them together.
- The sidebar sits on `canvas-deep` with a 1px right rule that separates it from the page.
- Auth, onboarding, reset, and public pages render full bleed without the sidebar inset.

### Sidebar

- Brand is the rabbit-note mark at 32px, plus the “Nana” wordmark and “Your workspace”. The wordmark starts on the navigation label line, and the mark anchors the sidebar edge. The sidebar and auth cover use the transparent, tightly cropped mark (cream on dark, ink on light). The favicon uses the cream mark on dark and the graphite app tile on light, so a dark rabbit never sits on a light tab. The graphite app tile is used in About, public pages, install surfaces, and PWA any/maskable/monochrome icons.
- A full-width inverted `ink` **New** button sits under the brand and opens a Note/Board menu. It is global chrome, not the contextual primary action; page-level primary actions take `signal-bright`.
- Primary navigation rows are 32px with 6px radius. The active row is `surface` with a hairline and an ember icon; inactive rows are transparent with muted icons. There are no inverted navigation chips. Chat is not a page row: the full sidebar places a signal-tinted **Chat** action above **New**, the collapsed rail keeps a distinct signal-tinted chat icon above the page icons, and mobile keeps a bottom-bar item. All toggle the global dock. Cmd/Ctrl+J remains the keyboard shortcut, and the full `/chat` page stays deep-linkable.
- Section labels are 11.5px medium muted: “Recent”, “Library”.
- The Library tree lists root notes and root boards, then folders; an expanded folder lists its notes and boards with the same 20px row rhythm. Notes use the document glyph, boards the four-column glyph, private boards keep the warning lock, public records take the success share glyph, and records shared directly with people take the signal-tinted two-person glyph. The Library header carries New folder, New note, New board, and Trashed boards actions.
- The profile bar stays at the bottom with avatar, name, email, and settings.
- The collapsed rail uses 40px targets. The active icon sits on a `surface` tile with a hairline and takes the ember colour.

### Content pages

- Mobile gutters: 20px. Desktop: 32–48px.
- Every route opens with `PageHeader` inside `PageShell`: a 28/34px title, one supporting sentence, optional meta strip, optional back link, right-aligned actions, and a single bottom rule. There is no decorative rule above the title.
- Long collections scroll inside the `PageShell` (or an inner panel for board lanes, chat, and folders), not the window.

## Page patterns

### Timeline

`/timeline` is a 2-column reading view when the route content has room: a notes-and-boards feed and a 20rem utility rail. The split is driven by a container query, not the viewport, so opening the chat dock collapses it to the feed with the calendar behind the **Dates** action.

- Feed cards are 10px panels on `surface` with a hairline. Note cards carry a title, one-line metadata, a three-line plain-text preview, tags, and reading statistics. Board cards carry a board icon, title, updated/folder metadata, a description preview, and open/done counts. Both card types expose the same overflow button, right-click menu, and touch long-press menu; board menus include Share, Export, and Move to trash. There is no hover rail and no rendered Markdown inside a card; note previews are stripped to text so the title never repeats.
- Group labels use a 12.5px semibold label, a rule, and a plain numeric count.
- The rail holds the search field, month calendar, and an “In this view” card with note, board, and folder counts. Its lower action opens Trashed boards; there is no board index.
- A compact segmented **All / Notes / Boards** filter sits above the feed and carries the current count in each label. **New** opens the Note/Board menu.
- The calendar is a compact 7-column grid with 36px date cells and a `signal-bright` fill for the selected range.

### Public board reader

`/public/board/:shareToken` is a reading page, not a kanban.

- The top bar carries the author, board name, open/done counts, update date, and expiry badge.
- The body is one max-3xl panel. The board description renders as Markdown, then non-empty status sections follow: a mono index, status label, count, rule, and task rows.
- Task rows are flat `surface` panels with a title, plain-text description, priority code, due date, and outline labels. Done rows use a success check and reduced opacity. There are no drag handles, menus, private links, or note links.

### Board detail

`/board/:boardId` is four kanban lanes.

- Each lane is a 10px `surface-sunken` panel with a 1px border, 10px inner padding, a status dot, label, plain count, add button, scrollable card body, and an Add task footer. The new-task composer sits outside the scroll area so its primary action is always visible; clicking a card opens the non-modal task edit side panel.
- Task cards are 7px-radius `surface` panels with a 13.5px medium title, two-line excerpt, and compact meta chips for priority, due date, linked note, and labels. Done titles are muted and struck through.
- Mobile is a horizontal snap row; the helper reads “Swipe between columns.” Desktop shows all four and reads “Drag between columns.”
- The header is `PageHeader` with a back link to the timeline, open/done in the meta strip, a share icon, and Import note / New task / Edit actions. A public board also carries the success share glyph beside its title. Edit turns the page into the inline board settings form; New task opens the lane composer.

### Trash

`/board/trash` uses `PageHeader` with a back link and a trashed-count meta strip, then reuses the board card language with a muted status dot, task count, trashed date, Restore, and a danger-toned Delete forever action. The empty state is centred.

### Chat

`/chat` uses the shared `PageHeader` and an 800px reading column, with a collapsible history panel.

- Header: shared masthead, title `Chat` or the conversation title, a model/status meta line, Work/Ask, New chat, and History. The dock also has a left-edge resize handle and persists its width.
- Empty state: 26/30px “Ask, or change something.” in Work, one supporting sentence, and four prompt cards in a 2×2 grid. Prompt cards have a neutral icon tile, 13px medium text, and an arrow that darkens on hover.
- Composer: a 10px-radius `surface` shell with a 1px border, a textarea, an 11px hint, a compact model pill, a context-usage donut, an attach control, and a `signal-bright` send button (44px on touch, 36px on desktop). Focus is an ember border plus a soft 4px ring. The donut opens a details card; it is signal, warning at 75%, and danger at 90%, and never invents a percentage when the model window is unknown.
- Assistant answers are document text at 14.5px / 1.75, max 68ch, preceded by a 28px rabbit tile and “Nana”; the dock header mark is 32px. User messages are right-aligned `surface-raised` blocks with a 10px radius and 3px bottom-right corner. Titles are plain text; no emoji.
- Page context is automatic and invisible: the composer sends only the current record id, and the model is told to read it through tools when needed.
- Tool activity is one neutral summary pill with an ember dot while running, a success dot when done, and an optional one-line-per-tool disclosure. Applied edits join the same disclosure as collapsed one-line rows with the same icon/title/detail/status geometry; expanding one reveals details and actions. The final answer stays below the disclosure. Sources are a count disclosure, not a wall of chips. User attachments remain compact outline chips above the bubble.
- Reasoning is a collapsible details block with a 13px muted body and a left rule.
- History is a 16rem right panel with a neutral New chat action and a `signal-soft` active row. There is no accent rail beside the row.

### Folders

`/folders` is a library explorer.

- Header uses `PageHeader` with folder/note counts in the meta strip, then a Files/Trash/Shared segmented control above a hairline.
- The path row has Up, breadcrumb chips, List/Grid, and the drag-help popover. The current breadcrumb is a neutral `surface` chip, not ember.
- The list is flat on the canvas, not inside a giant panel. A small Name/Details header sets the columns; rows are full-width hover surfaces separated by hairlines, with a 36px icon tile, 13.5px title, metadata, a one-line excerpt, tags, and an actions menu.
- Grid cards are at least 9rem tall with a 40px icon tile, title, word count, two-line excerpt, and tags.
- Empty states are compact and centred on the canvas, with no nested border.

### Editor

`/document/:id` is a writing desk.

- Header: 22px title input on desktop (17px on mobile), saving/unsaved text, Editor/Source/Split segmented control, fullscreen, overflow, and close. The **Ask Nana** action is mobile-only and hidden at the 768px desktop breakpoint; there is no desktop header AI button or separator. There is no rule above the title. On mobile the header actions are 44px targets; Share, export, save-version, Hide header, and Move to trash live in the overflow menu. Fullscreen expands the writing/reading surface to the available route width and persists across documents.
- Tags sit on a second rule with neutral outline pills.
- The writing surface is a 10px `surface` panel inside `canvas`, max 920px for Editor/Source and 1240px for Split. Rendered text and source use 15px / 1.75 with 24–40px inner padding.
- An agent edit flashes in place for 420ms: inserted text is `success-soft` with a success underline, deleted text is a red strike-through widget, and both editor panes share the timing. Large rewrites use the short section wash. The animation is visual only: it paints decorations against the current document, never replaces it or changes the selection. On a live note both editor surfaces re-check the body at effect time and skip the flash when it differs. Pending flash timers are cancelled on note switch, a newer AI edit, and unmount; body changes are covered by the effect-time guards.
- The raw Markdown editor uses the sans face, not mono. Rendered headings are forced to the sans face by the MDEditor overrides.
- GitHub-style alerts use alert-only semantic tokens: Note blue, Tip green, Important purple, Warning amber, and Caution red. They are the deliberate exception to Graphite's one-accent rule because readers recognise the GitHub convention. Alerts are flat callouts with a 3px semantic left rule, a soft fill, and an uppercase label; the tokens are separate from `signal`, `success`, `warning`, and `danger`. Raw `<details>`/`<summary>` blocks render as collapsed disclosure rows in Milkdown and as native details in previews; the tags stay in the Markdown source.
- The footer is a fixed status bar at the bottom of the content area: left offset matches the sidebar or rail, right edge stops at the chat dock, `canvas-deep`, with word count, reading time, characters, attachments, and updated time. It publishes its measured height as `--nana-footer-height`; the writing surface reserves that height and ends above the bar instead of scrolling underneath it.

### Auth and onboarding

- Two columns on desktop: a theme-invariant cover on the left and a form on the right.
- Cover: inverted ink tile plus wordmark, 38/48px “A quieter place to think.”, one supporting paragraph, three hairline-separated pillars with muted icons, and a self-hosted status line.
- Form: 10px `surface` panel, 24px title, email/password fields, full-width primary action, and a quiet footer. There is no ember rule above the title.
- On mobile the cover stacks above the form and keeps its dark ground.

### Settings

Settings uses the shared `PageShell` and `PageHeader`, keeps an 11rem left rail on desktop and a two-column tab grid on mobile, and bounds the working area at 1100px. Active tabs are neutral `surface` rows with a hairline and an ember icon. Cards use the shared 10px panel. The theme picker previews the actual Graphite canvases and ember.

### Public pages

Public notes and folders use the same canvas and panel language without app chrome. The reading measure stays narrow; the public bar uses `canvas-deep` and centres the page title between the author block and the meta.

## Components

The primitives live in `src/components/ui/`; `Toast` and `ToastHost` live in `src/components/`.

| Component | Contract |
| --- | --- |
| `Button` | Variants `primary` (`signal-bright` fill), `secondary` (`surface` + hairline), `ghost`, `danger`, `link`. Sizes `sm` 32px, `md` 36px, `lg` 44px. Medium 12.5–14px. Loading spinner replaces the leading icon. |
| `IconButton` | Square 28/36/44px; `label` is required and becomes `aria-label` and `title`. Default variant is `ghost`. |
| `Field`, `Input`, `Textarea`, `Select` | Label + optional marker + hint + error. Inputs are 40px, `surface-sunken`, hairline, and switch to `surface` on focus with an ember border and a 4px soft ring. `Input` accepts leading icon and trailing action slots; `Select` owns its chevron. |
| `Switch`, `Checkbox`, `SegmentedControl` | Native semantics, 150ms state change, ember for on/selected. `SegmentedControl` uses a bordered surface pill inside a sunken track. |
| `Card`, `SectionHeading` | `Card` is a 10px panel with a hairline. `SectionHeading` renders a 17px title, description, and actions; its `eyebrow` prop is accepted but not rendered. |
| `InlineForm` | Flat in-page form panel with header, optional close, body, and footer. It replaces data-entry dialogs: no scrim, no focus trap, no scroll lock. |
| `SidePanel` | Non-modal right inspector for share settings, task editing, and pickers. Full-width on mobile, 26/32rem on desktop, no scrim, Escape/outside close, focus restore. |
| `Dialog` | Portalled, focus-trapped, Escape/backdrop close, scroll lock, nested stack, exit animation. Sizes `sm`/`md`/`lg`/`xl`/`full`. Mobile becomes a bottom-anchored sheet. Reserved for warnings, destructive confirmations, and version previews; never for data entry. |
| `ConfirmDialog` | Built on `Dialog`; `tone="danger"` for destructive actions; verb confirm label. |
| `Sheet` | Mobile bottom sheet with drag handle, scrim, Escape, focus restore, safe-area padding. |
| `MenuSurface`, `MenuItem` | Fixed floating menu, outside-click + Escape, 140ms pop, `shadow-float`; `MenuItem` supports a danger tone and a hint. |
| `PageShell` | The shared route frame: centered max-1280px field, 20/32/48px gutters, page or content scroll. Every authenticated page uses it once. |
| `PageHeader` | 28/34px title, one supporting sentence, optional meta strip, optional back link, right-aligned actions, single bottom rule. The `eyebrow` prop is accepted but not rendered. |
| `EmptyState` | Centred 10px `surface` panel with an optional neutral icon tile, 17px title, explanation, and actions. `compact` drops the panel chrome and left-aligns the copy for dialogs and inline contexts. |
| `Badge` | Tones `neutral`, `signal`, `warning`, `success`, `danger`, `outline`; optional dot; 5px radius. Note tags use `outline`. |
| `Spinner` | Signal-topped ring, 20px default; pass a `label`. |
| `Avatar` | Image or initial fallback on a raised surface. |
| `Toast` | Raised panel, semantic icon, message, dismiss. No accent bar and no type label. |

Rules:

- Data entry is inline (`InlineForm`) or in a `SidePanel`. A new centred `Dialog` is only for a warning, destructive confirmation, or preview; a share/picker/editor never uses one. No bespoke overlay shells.
- Destructive confirmation always uses `ConfirmDialog` with `tone="danger"` and a verb label (“Move to trash”, “Delete forever”). Never a green destructive button.
- Icon-only buttons require `label`.
- Empty states explain the next action; they do not blame the user.
- Do not put a shadow on a page-level card. Shadows belong to overlays.

## Motion

- App durations: 140–260ms. Standard easing is `ease-out` or the house `cubic-bezier(0.22, 1, 0.36, 1)`.
- Dialogs: 220ms fade + 10px rise + scale from 0.985; exit 160ms. Sheets: 260ms rise; exit 180ms. Side panels: 220ms fade + 18px slide from the right. Inline forms: 200ms fade + 8px drop. Install banner: 220ms fade + 12px rise.
- Menus: 140ms pop from 0.97 with a 2px lift.
- Desktop route content: 260ms, 4px rise. Mobile route change: 240ms, 14px lateral slide in the route order.
- Hover changes colour, border, and tone. It does not change size. Dragging a task uses 40% opacity and a 2px signal insertion line.
- Respect `prefers-reduced-motion`; `src/index.css` reduces all animation and transition durations to `0.01ms`.

## Voice

- Concrete, calm, second person. “Move this board to trash?” not “Are you sure you want to proceed?”.
- Buttons are verbs: “Save sharing”, “Create task”, “Restore version”, “Delete forever”.
- Labels are nouns: “Public access”, “Attachments”, “Start page”, “Progress”.
- Board copy is plain about consequence: “You can restore it any time from Trash.”
- No exclamation marks, no “simply”, no “Oops”.
- Dates: relative for the last day (“2h ago”), short absolute after (“Oct 23”), with a year once outside the current year.
- Never call the mascot a fox. It is a rabbit and its note: the app icon shows the rabbit peeking over a landscape note.

## Theme

`src/lib/theme.ts` owns the preference: `system`, `dark`, or `light`, stored under `nana-theme`. `initTheme()` runs before React mounts; it sets `data-theme` on `<html>`, updates `color-scheme`, and updates the `theme-color` meta (`#0c0c0d` dark, `#faf9f7` light). Utilities read the tokens, never the preference. The profile menu has a quick toggle; Settings → Preferences has the three-tile picker with Graphite previews.

## Gotchas & invariants

- **Route content is not framed.** The content inset is exactly the sidebar width (or 64px for the rail), with no gap or outer card. Every authenticated route wraps once in `PageShell`; the editor footer is fixed to `bottom: 0`, `right: 0`, with the same left offset. If you change the sidebar or rail width, update `src/App.tsx`, `src/components/Footer.tsx`, and `src/components/sidebar/CompactSidebar.tsx` together.
- **The compact rail is 64px.** `src/App.tsx` and `src/components/Footer.tsx` each hold a `COMPACT_SIDEBAR_WIDTH` constant. The rail, the content inset, and the footer offset must move as one.
- **`PageHeader` is the only masthead.** Do not hand-roll a route header with a different title scale, rule, or action alignment. Child routes pass `back`; counts and model status pass `meta`. `PageShell` owns the max width and gutters.
- **Milkdown is headless; the ProseMirror shell needs its structural CSS.** `src/index.css` imports ProseMirror view/gapcursor/table CSS before `milkdown.css`. Without it, lists, tables, and gap cursors break. The editor theme is scoped under `.nana-md .ProseMirror`, so Tailwind utilities elsewhere cannot leak into the document.
- **The writing surface is sans.** ProseMirror prose and the CodeMirror source pane stay on `var(--font-sans)` at 15px / 1.75. Mono in the writing surface breaks the one-voice rule; code blocks and inline code use `var(--font-mono)` only inside the prose.
- **Milkdown must not dirty a note on open.** The first serialization can normalize Markdown. The editor records that baseline and only reports changes after the user edits; if this guard is removed, opening a note creates a version on autosave.
- **Ember does two jobs only.** Use `signal` for links, icons, focus, and selection marks; use `signal-bright` for filled actions, progress, and selected calendar days. White on the light fill (`#b7431e`) is 5.48:1; near-black on the dark fill (`#ff7048`) is 7.0:1. Never put `text-signal` on a `signal-bright` fill.
- **The active navigation row is neutral.** It is `surface` with a hairline and an ember icon. Do not restore the old inverted ink chip or copy inversion to page cards.
- **The auth cover is intentionally theme-invariant.** It uses `cover` tokens, not `canvas` or `ink`. Reusing `canvas` there makes the cover flip to light in the light theme and breaks the first-screen composition.
- **Page-level cards never carry a shadow.** Only dialogs, sheets, side panels, menus, toasts, and the install banner use `shadow-float`.
- **One family, no mono metadata.** UI counts, dates, percentages, and priorities use Geist with `tabular-nums`. `font-mono` is reserved for code, ids, and URLs.
- **The rabbit is not a tiny chrome glyph.** The rabbit-note app tile and wordmark lead the shell; chat identity marks are 28–32px, the dark-theme favicon uses the tight, transparent cream mark, the light-theme favicon uses the graphite tile, and the full mascot stays in About, public pages, the install prompt, and the app icons so it is never an indistinct blob.

## Related docs

- [`product.md`](product.md) — audience, product truth, and surfaces.
- [`frontend.md`](frontend.md) — routes, state, board/chat implementation.
- [`ai.md`](ai.md) — chat tools and tool-activity contract.
- [`../src/index.css`](../src/index.css) — canonical token values, type, global styles, motion, and MDEditor overrides.
- [`../src/components/ui/`](../src/components/ui/) — shared primitives.
