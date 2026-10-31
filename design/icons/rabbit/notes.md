# Rabbit mark

## Idea

The existing Nana rabbit is an illustration: a cream body, a backpack, a pencil, and a ring-bound notebook. Almost all of that disappears at 32px, and all of it disappears at 16px. This direction keeps the two shapes that survive: the two tall ears and the round head. The result is a mascot mark, not a shrunken illustration.

The ears lean slightly outward and the head is a plain disc. The face is deliberately minimal: two dark eyes and a small nose, cut from the cream head. At 16px those details are gone; at 32px they give the mark its character.

## Palette

| Role | Value |
| --- | --- |
| Tile | `#0c0c0d` Graphite canvas |
| Mark | `#f5f3ef` Cream ink |
| Accent | `#ff7048` Ember |

One accent only. The inner ear is the ember; the eyes and nose are the tile colour showing through the head. No gradients, no outline, no shadow.

## Small-size behaviour

- **16px:** the head is a 7.6px cream disc with two ears. The ember inner ear becomes a thin warm line; the face disappears. The silhouette still reads as a rabbit because the ear-to-head ratio is extreme.
- **24–32px:** the face begins to resolve; the inner ear reads as a warm shape rather than a line.
- **48px+:** the full mark, including the eyes, nose, and tapered inner ear.

The dedicated `favicon.svg` is drawn on a 32-unit grid, not scaled down from 512. It removes the face entirely, widens the ears, and uses a 15.2-unit head diameter (7.6px radius) so the 16px raster lands on clean geometry.

## Variants

- `icon.svg` — 512 rounded-square tile, graphite ground, cream rabbit, ember inner ear.
- `favicon.svg` — 32-unit grid, no face, wider ears, ember inner ear.
- `maskable.svg` — full-bleed graphite, mark centred inside the 80% safe circle.
- `monochrome.svg` — solid silhouette only, no face or inner ear; use as an alpha mask for tinted icons.

## Notes

- This is the only direction that carries the existing mascot directly into the icon.
- The head is a circle, not a squircle, so it stays distinct from the monogram and note shapes.
- Do not add the notebook, pencil, or backpack back into the icon. They are the first things to turn to mud at 16px.
