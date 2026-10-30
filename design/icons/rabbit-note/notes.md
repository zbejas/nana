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

- **16px:** the rescaled master still shows the note, two ears, the face as a soft pair of eyes and nose, and the ember fold. It is less crisp than a dedicated 16px glyph, but it is the same character and keeps the face.
- **24–32px:** the ears, card, face, and folded corner are all visible.
- **48px+:** the hybrid is clear: a note with a rabbit's ears and face.

The selected favicon is the **rescaled 512 master**, not a separate 16px drawing. A thick-ear/big-eye variant was explored and rejected: at 16px it read as a different, slightly uncanny character. The master keeps the same geometry everywhere; at 16px the face becomes a soft pixel cluster rather than being removed.

## Variants

- `icon.svg` — 512 rounded-square graphite tile, landscape note, rabbit ears and face, ember fold.
- `favicon.svg` — the 512 master, used at tab size; the face is kept.
- `maskable.svg` — full-bleed graphite, mark scaled to 90% and centred inside the safe circle.
- `monochrome.svg` — solid card and ears, dog-ear cut, eyes and nose as alpha holes.

## Notes

- The clearest one-sentence story of the product: notes, with the Nana rabbit.
- At 16px the wide card softens the ear silhouette, so it is not the strongest tab icon.
- Best used for the install prompt, About, empty states, or a marketing lockup where the mark can be 48px or larger.
