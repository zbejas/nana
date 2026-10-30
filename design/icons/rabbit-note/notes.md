# Rabbit + note

## Idea

The rabbit becomes the note. A landscape card sits on the graphite ground; two long ears rise from behind its top edge; the face is cut into the paper; the top-right corner is folded in ember. It reads as a rabbit peeking over a note, not as an illustrated mascot.

The landscape card is deliberate. A portrait page immediately reads as a document; a landscape card reads as a note or a card, and gives the ears a wide, stable base. At 512 the mark is almost square: 320px wide, 338px tall including the ears.

## Palette

| Role | Value |
| --- | --- |
| Tile | `#0c0c0d` Graphite canvas |
| Card and ears | `#f5f3ef` Cream ink |
| Fold | `#ff7048` Ember |

Only the fold is ember. The eyes and nose are cut out of the paper, so they disappear cleanly at small sizes instead of turning into grey dots.

## Small-size behaviour

- **16px:** a cream card with two thick ears and two dark eyes. The nose is a single warm-dark pixel; the fold is a warm corner. The face survives the 16px raster because the favicon variant enlarges the eyes and widens the nose.
- **24–32px:** the ears, card, face, and folded corner are all visible.
- **48px+:** the hybrid is clear: a note with a rabbit's ears and face.

The `favicon.svg` (v4) uses a 32-unit grid: a narrower note, thicker ears, enlarged eyes, a wider nose, and a larger fold. It is deliberately a separate 16px-first drawing, not the 512 master scaled down: the master's thin ears and small face blur on a 16px grid. The app/PWA icons keep the full master.

## Variants

- `icon.svg` — 512 rounded-square graphite tile, landscape note, rabbit ears and face, ember fold.
- `favicon.svg` — 32-unit grid, v4: thicker ears, enlarged face, narrower note, larger fold.
- `maskable.svg` — full-bleed graphite, mark scaled to 90% and centred inside the safe circle.
- `monochrome.svg` — solid card and ears, dog-ear cut, eyes and nose as alpha holes.

## Notes

- The clearest one-sentence story of the product: notes, with the Nana rabbit.
- At 16px the wide card softens the ear silhouette, so it is not the strongest tab icon.
- Best used for the install prompt, About, empty states, or a marketing lockup where the mark can be 48px or larger.
