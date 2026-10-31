# N monogram

## Idea

An N built from a sheet of paper rather than a typeface. The left stem is the page edge, the diagonal is the fold across the sheet, and the top-right corner is a dog-ear. The cream tile is the paper; the graphite N is the writing. The ember corner is the only colour event.

The N is deliberately heavy: 76px stems on a 512 canvas, with a 76px-wide diagonal. The counters are open enough to survive a 16px raster. The dog-ear is at the top-right, away from the diagonal joint, so the N never looks broken.

## Palette

| Role | Value |
| --- | --- |
| Tile | `#faf9f7` Paper |
| N | `#1a1a18` Graphite ink |
| Fold | `#b7431e` Light-theme ember |

The tile is theme-invariant: it stays paper in dark and light UI. That is why the fold uses the light-theme ember (`#b7431e`) rather than `#ff7048`; it holds contrast on cream. The icon is its own surface, so it does not need to flip with the app theme.

## Small-size behaviour

- **16px:** a cream tile with a dark N. This is the crispest tab icon of the four; the letterform is readable before the tile is.
- **24–32px:** the dog-ear becomes a visible notch; the ember fold is a warm corner.
- **48px+:** the page construction reads: the N is clearly cut from a sheet, not set in a font.

The `favicon.svg` uses a 32-unit grid: 4px stems, 4px diagonal, a 3px dog-ear, and a 3px ember fold. At 16px, the N is still three clean strokes.

## Variants

- `icon.svg` — 512 rounded-square paper tile, graphite N, ember dog-ear.
- `favicon.svg` — 32-unit grid, 4px strokes, simplified fold.
- `maskable.svg` — full-bleed paper, N scaled to 90% and centred inside the 80% safe circle.
- `monochrome.svg` — N silhouette with the dog-ear cut out; the ember fold is omitted because the alpha mask cannot carry it.

## Notes

- The strongest option for pure legibility and for both light and dark chrome.
- The weakest option for mascot continuity: it reads as a publishing or writing tool, not specifically as Nana's rabbit.
- Works as a fallback mark if the rabbit feels too soft in real tabs.
