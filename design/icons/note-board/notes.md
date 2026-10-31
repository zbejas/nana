# Note + board

## Idea

Three note cards standing as kanban columns, sharing a baseline. The middle lane is tallest and carries one ember task card. The right card has a folded corner in ember. The different heights are the board signal; the fold is the note signal.

This avoids the generic document icon: there is no ruled page, no portrait sheet, and no list. It is a board made of paper, or a set of notes arranged as a board.

## Palette

| Role | Value |
| --- | --- |
| Tile | `#0c0c0d` Graphite canvas |
| Cards | `#f5f3ef` Cream ink |
| Accent | `#ff7048` Ember |

The ember appears twice: the single task card and the folded corner. They are the only warm pixels. The cards are flat; no outlines, shadows, or lane backgrounds.

## Geometry

- 512 canvas: three cards 84px wide, 24px gaps, sharing a baseline at y=392.
- Heights: left 224px, middle 260px, right 208px.
- Ember task card: 52×52px, 16px inside the middle lane.
- Dog-ear: 36px on the right card, with a matching ember fold.

## Small-size behaviour

- **16px:** three cream bars with a small warm dot. It reads as a board or a set of columns; the fold is a single ember pixel and the note cue is weak.
- **24–32px:** the differing heights and the fold become visible; the ember task card reads as a card rather than a dot.
- **48px+:** the three lanes and the folded page are unambiguous.

The `favicon.svg` is drawn on a 32-unit grid with 5.2px cards, 1.5px gaps, and a 2.8×2.4px ember card. The fold is enlarged proportionally so it survives 16px.

## Variants

- `icon.svg` — 512 rounded-square graphite tile, three cream cards, ember card and fold.
- `favicon.svg` — 32-unit grid, simplified cards and fold.
- `maskable.svg` — full-bleed graphite, cards scaled to 90% and centred.
- `monochrome.svg` — three card silhouettes with the dog-ear cut; the ember card is omitted.

## Notes

- The most product-specific direction: notes and boards in one mark.
- At 16px it can read as a bar chart if the viewer does not know the product. That is why it ranks below the rabbit and the monogram as an app icon.
- Strongest as a secondary glyph: empty board states, board settings, or the install illustration.
