# Rabbit + note

## Idea

The rabbit becomes the note. A landscape card sits on the graphite ground; two long ears rise from behind its top edge; the face is cut into the paper; the top-right corner is folded in ember. It reads as a rabbit peeking over a note, not as an illustrated mascot.

The landscape card is deliberate. A portrait page immediately reads as a document; a landscape card reads as a note or a card, and gives the ears a wide, stable base. At 512 the mark is almost square: 320px wide, 338px tall including the ears.

## Palette

| Role | Value |
| --- | --- |
| Tile | `#0c0c0d` Graphite canvas (app/PWA icons only) |
| Card and ears | `#f5f3ef` Cream ink on dark; `#1a1a18` ink on light |
| Fold | `#ff7048` Ember |

Only the fold is ember. The eyes and nose are cut out of the paper, so they disappear cleanly at small sizes instead of turning into grey dots.

## Small-size behaviour

The favicon drops the tile entirely. It uses a tight `viewBox="68 44 376 376"` around the rabbit-note mark, so the drawing fills the 16×16 tab slot instead of sitting inside a wide, padded tile.

- **16px:** the cropped transparent mark shows the note, both ears, the face as two cut-out eyes and a nose, and the ember fold. It is larger than the old tiled favicon and reads on both light and dark chrome.
- **24–32px:** the ears, card, face, and folded corner are all clearer.
- **48px+:** the hybrid is clear: a note with a rabbit's ears and face.

Dark chrome uses cream paper (`favicon.svg`); light chrome uses ink paper (`favicon-light.svg`). The theme switch swaps the favicon files at runtime. At 16px the face is a soft pixel cluster, but it is the same character as the 512 master.

A separate thick-ear/big-eye 16px redraw was explored and rejected: it read as a different, slightly uncanny character. The shipped favicon is the master geometry, cropped and made transparent, not a different rabbit.

## Variants

- `icon.svg` — 512 rounded-square graphite tile, landscape note, rabbit ears and face, ember fold. App/PWA, sidebar, About, public pages.
- `favicon.svg` — transparent cropped master for dark chrome; cream paper, alpha-cut eyes and nose.
- `favicon-light.svg` — transparent cropped master for light chrome; ink paper, alpha-cut eyes and nose.
- `maskable.svg` — full-bleed graphite, mark scaled to 90% and centred inside the safe circle.
- `monochrome.svg` — solid card and ears, dog-ear cut, eyes and nose as alpha holes.

## Notes

- The clearest one-sentence story of the product: notes, with the Nana rabbit.
- The transparent favicon is intentionally not the tile icon. A tab is already a rounded surface; adding a second tile made the mark look small.
- Keep the master geometry. Do not redraw the face for 16px.
