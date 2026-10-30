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

- **16px:** a wide cream card with two long ears. The face is gone; the fold is a warm corner pixel. It still reads as a rabbit, though less immediately than the round rabbit head.
- **24–32px:** the ears, card, and folded corner are all visible. The face begins to resolve at 32px.
- **48px+:** the hybrid is clear: a note with a rabbit's ears and face.

The `favicon.svg` uses a 32-unit grid: a 20×12.5px card, 4.2×9.8px ears, no face, and a 3.5px fold. The ears are widened relative to the 512 master so the 16px raster keeps two clear vertical strokes.

## Variants

- `icon.svg` — 512 rounded-square graphite tile, landscape note, rabbit ears and face, ember fold.
- `favicon.svg` — 32-unit grid, no face, wider ears, simplified fold.
- `maskable.svg` — full-bleed graphite, mark scaled to 90% and centred inside the safe circle.
- `monochrome.svg` — solid card and ears, dog-ear cut, eyes and nose as alpha holes.

## Notes

- The clearest one-sentence story of the product: notes, with the Nana rabbit.
- At 16px the wide card softens the ear silhouette, so it is not the strongest tab icon.
- Best used for the install prompt, About, empty states, or a marketing lockup where the mark can be 48px or larger.
