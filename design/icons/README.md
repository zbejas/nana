# Nana — app icon and favicon system

**Status:** design exploration. Nothing in `src/`, `public/`, `package.json`, or `docs/` was changed. All work lives under `design/icons/`.

This is a compact icon system for Nana, not a shrunken version of the existing rabbit illustration. Four directions were drawn at 512, rebuilt at 32 for the tab, and checked at 16, 24, 32, 48, 64, 128, 256, and 512 on both Graphite canvases. Each direction has a normal rounded-square icon, a tab-optimised favicon, a full-bleed maskable icon, and a single-colour monochrome mark.

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
    icon.svg  favicon.svg  maskable.svg  monochrome.svg  notes.md
```

Every SVG is flat, has no external fonts or images, and uses only Graphite values: graphite `#0c0c0d`, cream `#f5f3ef`, paper `#faf9f7`, ink `#1a1a18`, ember `#ff7048` (dark surfaces) or `#b7431e` (light surfaces). No gradients, grain, shadows, or raw blue/purple/green.

## What the current icon does

The current mark is `src/assets/nana.svg`: a 145 KB illustration with a cream rabbit, brown outlines, a backpack, a pencil, and a ring-bound notebook, in a 582×606 viewBox. It is used as the sidebar glyph at 32px, in About and public pages, in the install banner, and as the favicon. `nana-192.png` and `nana-512.png` are the same illustration at 17 KB and 61 KB.

At 16–32px, the notebook, pencil, backpack, face, and outline all collapse into a brown-cream smudge. The illustration is charming at 180px, but it is not a tab icon.

The current manifest also labels the same 192px and 512px PNGs as `"purpose": "any maskable"`. Maskable icons need an opaque full-bleed field and the important art inside the central 80% circle; this art runs close to the edges. The same file cannot be both a tight `any` icon and a safe `maskable` icon without compromise.

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

One deliberate choice: the favicons keep their tile instead of switching colours with `prefers-color-scheme`. The tab mark is identical in light and dark chrome, and third-party favicon services that rasterise once cannot capture the wrong theme.

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

- Best for: the install prompt, About, empty states, and marketing where the mark can be 48px or larger.
- Small-size behaviour: the v4 favicon keeps the eyes and nose, thickens the ears, narrows the card, and enlarges the fold so the 16px raster still reads as a rabbit and a note.
- Watch out: the wide card still softens the ear silhouette at 16px, so the favicon is a separate 16px-first drawing rather than a scaled master. The app/PWA icons keep the full 512 master.

## Ranking

The first test is 16px in a tab on both paper and graphite chrome. The second is whether the mark still says Nana without the wordmark. Maskable safety and light/dark contrast are pass/fail: all four pass.

| Rank | Direction | 16px | Brand fit | Light/dark | Maskable | Why |
| --- | --- | --- | --- | --- | --- | --- |
| **1** | **Rabbit mark** | Strong | Excellent | Strong | Strong | The only direction that carries the existing mascot into the icon, and the head-plus-ears silhouette still reads at 16px. |
| **2** | **N monogram** | Excellent | Good | Excellent | Excellent | The most reliable tiny icon and the best contrast on both surfaces. It loses the rabbit and reads more like a publishing tool. |
| **3** | **Rabbit + note** | Fair | Excellent | Strong | Strong | The clearest story of the product, but the wide card weakens the ear silhouette at 16px. Better at 32px and up. |
| **4** | **Note + board** | Fair | Good | Strong | Strong | The most product-specific mark, but at 16px the fold disappears and it can read as a bar chart. Best as a secondary glyph. |

**Recommendation: the rabbit mark.** It is the best balance of brand continuity, a distinctive 16px silhouette, and a safe maskable crop. The monogram is the rational fallback if the rabbit feels too soft in real tabs or if the product needs a more neutral, writing-first identity. Do not mix the two as the app icon and favicon; pick one and use its `favicon.svg` for the tab.

If the ranking were based on pure 16px optics alone, the monogram would be first. The rabbit wins because the app icon is the one place the mascot has to survive outside the app, and the round head plus two ears is still unmistakably Nana at 16px.

## If the rabbit is picked: integration checklist

Nothing below is done yet. This is the change set I would make.

1. **Add the masters** under `src/assets/icons/` (or another server-served asset directory): `nana-icon.svg`, `nana-favicon.svg`, `nana-maskable.svg`, `nana-monochrome.svg`.
2. **Generate rasters** from the SVG masters:
   - `favicon.ico` — real multi-size ICO with 16, 32, and 48px frames, generated from `favicon.svg`.
   - `apple-touch-icon.png` — 180×180, opaque, sRGB, no baked rounded corners. Use a full-bleed square version (the maskable master is a good base; a `square.svg` with the mark at 100% is slightly larger).
   - `nana-192.png`, `nana-512.png` — `purpose: "any"`, transparent or opaque is fine.
   - `nana-maskable-192.png`, `nana-maskable-512.png` — `purpose: "maskable"`, opaque, full-bleed.
   - Optional: `mstile-150.png` for legacy pinned Windows sites.
3. **Split the manifest purposes.** The current `"any maskable"` on one tight image is the main technical risk. Use separate `any`, `maskable`, and `monochrome` entries, and add the SVG:
   ```json
   {
     "id": "/",
     "start_url": "/timeline",
     "icons": [
       { "src": "/nana-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
       { "src": "/nana-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
       { "src": "/nana-maskable-192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable" },
       { "src": "/nana-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" },
       { "src": "/nana.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any" },
       { "src": "/nana-monochrome.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "monochrome" }
     ]
   }
   ```
4. **Update both manifest sources.** `src/index.ts` serves a programmatic manifest; `src/manifest.webmanifest` is the static file. They currently disagree on `start_url` (`/timeline` vs `/`). Make them identical and pick one start URL.
5. **Update `src/index.html`:**
   ```html
   <link rel="icon" href="/favicon.ico" sizes="32x32">
   <link rel="icon" type="image/svg+xml" href="/nana-favicon.svg">
   <link rel="apple-touch-icon" href="/apple-touch-icon.png">
   <link rel="mask-icon" href="/nana-monochrome.svg" color="#ff7048">
   ```
   Keep the existing `theme-color` meta; `src/lib/theme.ts` already updates it in light mode.
6. **Serve `/favicon.ico` as a real ICO**, not the SVG with `Content-Type: image/svg+xml`. Legacy consumers and some crawlers expect an ICO or PNG.
7. **Add Windows metadata only if pinned sites matter:**
   ```html
   <meta name="msapplication-TileColor" content="#0c0c0d">
   <meta name="msapplication-config" content="/browserconfig.xml">
   ```
   with a 150×150 tile. Windows 11 itself uses the app icon; the tile is for legacy pinned sites.
8. **Keep the sidebar drawing.** The 512 icon has a baked rounded tile, which is right for a favicon/PWA icon and wrong for the 32px sidebar glyph. Use the transparent `monochrome.svg` (or a `mark.svg` with `fill="currentColor"`) for the sidebar, and keep the existing illustration for About/public pages if you want the full character. Do not put the tile behind the sidebar mascot.
9. **Test the crop.** Use Chrome DevTools → Application → Icons → “Show only the minimum safe area for maskable icons”, and Maskable.app for circle, squircle, and teardrop masks. Check the 16px tab in light and dark, the iOS home screen, Android themed icons, and a Windows pinned tile if you ship the config.
10. **Cache.** Keep the existing cache headers; hashed/immutable asset names are preferable for the raster set.

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
