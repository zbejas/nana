# Nana — app icon and favicon system

**Status:** selected and shipped. `rabbit-note` is the app icon; its transparent, cropped rabbit mark is the favicon, with dark and light variants. The other three directions remain in `design/icons/` as explorations.

This is a compact icon system for Nana, not a shrunken version of the old rabbit illustration. Four directions were drawn at 512, rebuilt at 32 for the tab, and checked at 16, 24, 32, 48, 64, 128, 256, and 512 on both Graphite canvases. Each direction has a normal rounded-square icon, a full-bleed maskable icon, and a single-colour monochrome mark; the shipped `rabbit-note` also has transparent dark/light favicons.

## What is here

```text
design/icons/
  README.md                 this report
  preview.html              size, surface, mask, monochrome, and tab tests
  preview.png               full-page desktop screenshot (1600px)
  preview-zoom.png          16px favicons magnified 5.5× (optional crop)
  rabbit/
    icon.svg  favicon.svg  maskable.svg  monochrome.svg  notes.md
  monogram/
    icon.svg  favicon.svg  maskable.svg  monochrome.svg  notes.md
  note-board/
    icon.svg  favicon.svg  maskable.svg  monochrome.svg  notes.md
  rabbit-note/
    icon.svg  favicon.svg  favicon-light.svg  maskable.svg  monochrome.svg
    tab-preview.html  tab-preview.png  notes.md
```

Every SVG is flat, has no external fonts or images, and uses only Graphite values: graphite `#0c0c0d`, cream `#f5f3ef`, paper `#faf9f7`, ink `#1a1a18`, ember `#ff7048` (dark surfaces) or `#b7431e` (light surfaces). No gradients, grain, shadows, or raw blue/purple/green.

## What changed

The previous mark was a 145 KB illustration with a cream rabbit, brown outlines, a backpack, a pencil, and a ring-bound notebook, in a 582×606 viewBox. It was used as the sidebar glyph at 32px, in About and public pages, in the install banner, and as the favicon. At 16–32px the notebook, pencil, backpack, face, and outline collapsed into a brown-cream smudge.

That illustration is gone from every surface. `src/assets/nana.svg`, `nana-icon.svg`, the PWA PNGs, the sidebar, About, the install banner, public pages, and the chat mark now use the `rabbit-note` master. The favicon is a separate transparent, tightly cropped version of the same master: cream on dark chrome, ink on light chrome, no tile. The manifest separates `any` and `maskable` icons so the mark stays inside the safe circle.

## Research: what shaped the work

The rules below are the ones that actually changed the drawings.

1. **Design the smallest size first.** A favicon is a separate piece of art, not a scaled logo: one bold shape, two or three flat colours, no text, no thin strokes. If it fails at 16×16, no export setting fixes it. ([Favicon Builder](https://faviconbuilder.com/guides/favicon-design-best-practices), [ImageMint](https://imagemint.net/tutorials/favicon-sizes-guide), [Square Town](https://square.pov.town/blog/favicon-design-tips-16px))
2. **Silhouette over detail.** A good test is to fill the mark in one colour; if the idea survives, it will survive anti-aliasing. This is why the rabbit lost the notebook and the note shapes are built from large flat blocks. ([Square Town](https://square.pov.town/blog/favicon-design-tips-16px))
3. **Maskable is its own file.** The safe zone is a centred circle with a radius of 40% of the icon width — an 80% diameter. The background must be opaque and full-bleed. Separate `any` and `maskable` entries instead of using `any maskable` on tight artwork. ([web.dev](https://web.dev/articles/maskable-icon), [MDN](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Define_app_icons), [Maskable.app](https://maskable.app/))
4. **Apple applies the mask.** Supply a square, opaque 1024px master; do not bake in rounded corners, transparency, or a drop shadow. Avoid text and very thin strokes. iOS also supports dark and tinted appearances, so a monochrome mark matters. ([Apple HIG](https://developer.apple.com/design/human-interface-guidelines/app-icons))
5. **Android themes the icon.** Adaptive icons use foreground and background layers; Android 13+ can tint a supplied monochrome layer with the user's wallpaper palette. The monochrome layer must work on both light and dark tints. ([Android adaptive icons](https://developer.android.com/develop/ui/compose/system/icon_design_adaptive), [MDN manifest icons](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/icons))
6. **Windows needs a few discrete sizes.** 16, 24, 32, 48, and 256 cover the common app-icon contexts. Windows 11 does not use the old live tiles, but a 150×150 tile is still useful for pinned legacy sites. ([Microsoft icon construction](https://learn.microsoft.com/en-us/windows/apps/design/iconography/app-icon-construction))
7. **SVG is the primary favicon, with fallbacks.** Chrome, Firefox, and Edge support SVG favicons; Safari still wants an apple-touch-icon and a PNG/ICO fallback. SVG can carry a `prefers-color-scheme` query, but the base drawing should work on both light and dark chrome without it. ([MDN](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Define_app_icons), [ImageMint](https://imagemint.net/tutorials/favicon-sizes-guide))
8. **One idea, one accent.** The strongest note/productivity icons are a single object or letter with a strong field: Notion's N, Bear's bear, Things' check, Obsidian's gem. The detail lives in the silhouette, not in decoration. ([Notion](https://www.notion.com/), [Bear](https://bear.app/), [Things](https://culturedcode.com/things/), [Obsidian](https://obsidian.md/))

### Reference icons and what is worth borrowing

| App | Mark | What works | What Nana should not copy |
| --- | --- | --- | --- |
| Notion | Black N on a paper tile | One glyph, extreme contrast, no detail. Reads at any size. | It is a letter, not a character; Nana has a mascot. |
| Bear | Bear silhouette on a colour field | One recognisable animal, one flat field, no text. | Recognition leans on the field colour, not just the shape. |
| Craft | Layered paper/card forms | Distinctive, warm, obviously a document tool. | Too many overlapping shapes for 16px. |
| Obsidian | Faceted gem | A single geometric silhouette with a strong profile. | Colour does most of the recognition; it would fail a monochrome test. |
| Apple Notes | Yellow notepad with lines | Literal, friendly, instantly a notes app. | The ruled lines are the first detail to vanish; the small icon needs a simplified version. |
| Linear | Geometric L / gradient field | One idea, high contrast, very controlled. | The gradient is a brand exception; Graphite has no gradients. |
| Things | Blue circle with a white check | One idea, one colour, one check. Reads at 16px. | A check means "done", not "write"; wrong metaphor for Nana. |
| Capacities | Warm C / circular field | A single letter, a warm field, a calm voice. | Again a letter; it gives up the rabbit. |

The shared lesson: the best icons are not illustrations with the detail turned down; they are a different, smaller idea that shares the brand's DNA.

### Common failure modes, and how these directions avoid them

- **Too much detail.** The current 145 KB illustration is the cautionary example: backpack, pencil, notebook, face, and outline all compete at 16px. The new marks have two to four large shapes.
- **Thin strokes and hairlines.** A 1px rule at 512 becomes 0.03px at 16. Every stroke here is a filled block at least 20px wide on the 512 canvas; the smallest ember detail is the 20px inner ear, which is allowed to disappear.
- **Low contrast.** Cream on paper is nearly invisible. Each direction commits to a tile: graphite behind cream, or paper behind graphite. The mark never depends on the page background.
- **Small text.** There is no rendered text in any SVG, not even a letter that is supposed to be read as a wordmark. The N is a shape; it is not set in a font.
- **Relying on colour alone.** The `monochrome.svg` files are the proof: each idea survives as a flat alpha silhouette. If the ember is removed, the shape still reads.
- **Dark-mode invisibility.** The dark-tile directions keep a cream mark; the monogram keeps a paper tile with a graphite N. None of them use a transparent background as the primary icon.
- **Bad maskable cropping.** Each `maskable.svg` is a separate full-bleed file with the mark inside the central 80% circle. The normal `icon.svg` is not reused as maskable.
- **Baked corners and transparency on Apple.** The `icon.svg` tiles are for the web/PWA; the iOS master should be a full-bleed square PNG and let iOS apply the squircle. The integration notes below call this out.
- **An inconsistent mark across surfaces.** Each direction ships one `favicon.svg`, one `icon.svg`, one `maskable.svg`, and one `monochrome.svg` from the same geometry. Do not mix the rabbit favicon with the monogram app icon.

One deliberate choice for the shipped favicon: the tile is removed, the mark is cropped tight, and the paper colour switches with the app theme (cream on dark, ink on light). A tab is already a rounded surface; a second tile inside it made the mark look small. Third-party services that rasterise once still get a valid transparent PNG, and the in-app theme swap keeps the silhouette legible.

## The four directions

### 1. Rabbit mark — `rabbit/`

The existing rabbit reduced to two ears and a round head. The head and ears are one cream silhouette; the inner ear is a tapered ember shape; the face is two dark eyes and a small nose. The dedicated favicon removes the face entirely and widens the ears on a 32-unit grid.

- Best for: brand continuity, the sidebar mascot, the install prompt, the app icon.
- Small-size behaviour: at 16px the head is a 7.6px disc with two ears; the face is gone and the ember is a thin warm line.
- Watch out: the ember inner ear can read as a carrot if it is widened too far. Keep it tapered and inside the cream ear.

### 2. N monogram — `monogram/`

An N made from a sheet of paper: a graphite N on a paper tile, a dog-eared top-right corner in ember, and a diagonal that reads as the fold. The tile is theme-invariant, so the N is always graphite on cream.

- Best for: the crispest 16px tab icon and the most reliable light/dark contrast.
- Small-size behaviour: at 16px it is three heavy strokes; the dog-ear becomes a 1.5px bevel and the ember a corner glint.
- Watch out: it gives up the rabbit. It is a writing-tool mark, not a Nana-specific character.

### 3. Note + board — `note-board/`

Three cream note cards standing as kanban columns, sharing a baseline. The middle lane is tallest and holds one ember task card; the right card has an ember dog-ear. The different heights are the board; the fold is the note.

- Best for: board surfaces, empty states, and any context where the product's notes-plus-boards story must be explicit.
- Small-size behaviour: at 16px it is three cream bars with one warm dot. The fold is a single ember pixel; the note cue only arrives at 32px.
- Watch out: at 16px it can read as a bar chart. It is a strong secondary glyph, not the strongest app icon.

### 4. Rabbit + note — `rabbit-note/`

A landscape note card with two long ears rising from behind it; the rabbit's face is cut into the paper; the top-right corner is folded in ember. The rabbit is the note, not a character holding one.

- Best for: the app/PWA icon, sidebar, About, install prompt, empty states, and marketing.
- Small-size behaviour: the favicon is the transparent, tightly cropped 512 master, not a separate redraw. The face survives as cut-out eyes and a nose; the mark fills the tab slot on both dark and light chrome.
- Watch out: a separate thick-ear/big-eye favicon was explored and rejected because it read as a different, uncanny character. Do not replace the master with a 16px redraw unless the silhouette is unmistakably the same rabbit.

## Ranking

The first test is 16px in a tab on both paper and graphite chrome. The second is whether the mark still says Nana without the wordmark. Maskable safety and light/dark contrast are pass/fail: all four pass.

| Rank | Direction | 16px | Brand fit | Light/dark | Maskable | Why |
| --- | --- | --- | --- | --- | --- | --- |
| **1** | **Rabbit mark** | Strong | Excellent | Strong | Strong | The only direction that carries the existing mascot into the icon, and the head-plus-ears silhouette still reads at 16px. |
| **2** | **N monogram** | Excellent | Good | Excellent | Excellent | The most reliable tiny icon and the best contrast on both surfaces. It loses the rabbit and reads more like a publishing tool. |
| **3** | **Rabbit + note** | Strong (selected) | Excellent | Strong | Strong | The clearest story of the product. The shipped transparent, cropped favicon fixes the original 16px weakness of the tiled version. |
| **4** | **Note + board** | Fair | Good | Strong | Strong | The most product-specific mark, but at 16px the fold disappears and it can read as a bar chart. Best as a secondary glyph. |

**Selected: rabbit + note.** It tells the product story — a note with the Nana rabbit — and the transparent, cropped favicon now fills the tab slot instead of shrinking inside a tile. The rabbit mark was the strongest pure-16px silhouette, but the selected direction keeps the character and the note together; that is the mark the product uses everywhere.

Do not mix directions as the app icon and favicon. The shipped favicon is the same rabbit-note geometry as the master, cropped and theme-aware.

## Shipped integration

The rabbit-note direction is wired into the app:

1. **Masters.** `src/assets/nana-icon.svg` is the 512 app/PWA tile; `nana.svg` is a copy used by the sidebar, About, public pages, install banner, and chat mark. `nana-icon-maskable.svg` and `nana-icon-monochrome.svg` are separate files.
2. **Favicon.** `src/assets/nana-favicon.svg` is the transparent cream version for dark chrome; `nana-favicon-light.svg` is the ink version for light chrome. Both use a tight `viewBox="68 44 376 376"` around the mark, with the eyes and nose as alpha cutouts.
3. **Rasters.** `nana-favicon-16.png`, `-32.png`, `nana-favicon-light-16.png`, and `-32.png` are generated from the SVG geometry. `nana-192.png`, `nana-512.png`, the maskable pair, the 180px Apple touch icon, and the monochrome PNG are generated from the tile/maskable masters.
4. **Theme swap.** `src/lib/theme.ts` updates every `link[data-favicon]` href when the resolved theme changes, so the favicon switches between the cream and ink glyphs with the app.
5. **Manifest.** `src/index.ts` and `src/manifest.webmanifest` split `any`, `maskable`, and monochrome purposes. The app icon is `nana-icon.svg`.
6. **HTML.** `src/index.html` links the bundled SVG/16/32 favicons with `data-favicon` slots; `/nana-favicon*` server routes provide the theme-specific files used by the swap.
7. **Fallback.** `/favicon.ico` serves the 32px dark favicon PNG for consumers that request the legacy path. The SVG and PNG links are the primary path.
8. **Sidebar and About.** Both use the master tile glyph. The mark is legible at 32px; the tile keeps the brand consistent with the app icon.

## Verification

- All 16 SVGs parse as XML.
- `preview.html` renders the actual SVG files at 16, 24, 32, 48, 64, 128, 256, and 512 on `#faf9f7` and `#0c0c0d`.
- `preview.png` is a full-page Playwright screenshot at 1600px CSS width.
- `preview-zoom.png` is the four 16px favicons magnified 5.5× without smoothing.
- The 16px tab test uses each direction's `favicon.svg`, not the 512 master.
- Maskable previews show full bleed, a circle mask, a squircle, and the 80% safe-area crop.
- Monochrome previews show the source alpha and three tints (ember, cream, ink).

## Open questions

- Is the rabbit's ember inner ear too warm at 512, or is it the right amount of character? It is the first thing to tune.
- Should the monogram tile be `#faf9f7` (paper) or `#ffffff` (surface)? Paper is warmer; white is crisper on a light tab.
- Does the note-board need a fourth, offset card to read as a stack rather than a chart at 16px? A fourth card would add detail without helping the tab.
- Should the app icon and the in-app sidebar use the same mark? The tile works for the icon; the sidebar wants a transparent glyph. That is a two-file system, not a single file.

## Sources

- [web.dev — Adaptive icon support in PWAs with maskable icons](https://web.dev/articles/maskable-icon)
- [MDN — Define your app icons](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Define_app_icons)
- [MDN — Manifest icons reference](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/icons)
- [Apple HIG — App icons](https://developer.apple.com/design/human-interface-guidelines/app-icons)
- [Microsoft — Construct your Windows app's icon](https://learn.microsoft.com/en-us/windows/apps/design/iconography/app-icon-construction)
- [Android — Adaptive icons](https://developer.android.com/develop/ui/compose/system/icon_design_adaptive)
- [Favicon Builder — Favicon design best practices](https://faviconbuilder.com/guides/favicon-design-best-practices)
- [ImageMint — Favicon sizes and formats that work](https://imagemint.net/tutorials/favicon-sizes-guide)
- [All SVG Icons — Favicon sizes 2026](https://allsvgicons.com/blog/favicon-sizes-guide)
- [Square Town — Favicon design tips: an icon that reads at 16 pixels](https://square.pov.town/blog/favicon-design-tips-16px)
- [IconsCove — Dark mode and tinted app icons](https://iconscove.com/blog/dark-mode-app-icons)
- [SplitMetrics — iOS app icon sizes and guidelines](https://splitmetrics.com/blog/guide-to-mobile-icons)
- [Maskable.app](https://maskable.app/) — mask preview tool
- [PWA Image Generator](https://www.pwabuilder.com/imageGenerator) — raster size reference
- Product pages used to inspect the reference icons: [Notion](https://www.notion.com/), [Bear](https://bear.app/), [Craft](https://www.craft.do/), [Obsidian](https://obsidian.md/), [Apple Notes](https://www.apple.com/notes/), [Linear](https://linear.app/), [Things](https://culturedcode.com/things/), [Capacities](https://capacities.io/)
