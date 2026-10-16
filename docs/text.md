# Text: engraved and embossed lettering

Lettering on a part (dial numerals, captions, nameplates, part numbers) is a **text entity in a sketch**. The kernel turns the
letters of a built-in font into closed loops, so everything that works on a sketch profile works on text: **Cut** engraves it,
**Extrude** embosses it. The kernel side (fonts, limits, checks) is described in the kernel repository's `docs/text.md`.

## Sketch editor: the Text tool

1. Open a sketch (on a plane or on a face). Choose **Text** in the Draw palette (key `Q`).
2. Click where the text should sit. A text entity with the string `TEXT` is placed at once and its panel opens; the lettering is
   drawn in the sketch colour and follows every change.
3. Edit it in the panel (here `RPM x100` on an arc of radius 16 around the origin, anchor centre-baseline):

   ![The Text tool: panel and live preview](img/text-tool.png)


   | Field | Meaning |
   |---|---|
   | Characters | the string (1 to 500 characters, one line) |
   | Cap height | height of a capital H in mm |
   | Font | **Gauge** (condensed sans) or **Engrave** (serif) |
   | Anchor | 3 x 3 grid: which point of the text sits on the clicked point (left / centre / right, top / middle / baseline) |
   | Angle, Spacing | rotation about the anchor in degrees, letter pitch factor (1 = the font's own) |
   | Mirror | flips the text (for the back of a clear part) |
   | On an arc | lays the letters along a circle: Radius (of the baseline), Direction (angle in degrees of the middle of the text seen from the centre, 90 = on top), Centre X / Y or **Pick centre** (then click a sketch point or any place), Side: *outside* reads clockwise with the tops away from the centre, *inside* reads counter-clockwise with the tops toward it |

4. **Done** (or Enter in the string field, or Esc) leaves the panel. Click the lettering later in Select mode to edit it again.

The anchor is a normal sketch point: drag it, fix it, dimension it or snap other geometry to it like any other point. Delete removes
the text and its anchor point; Copy / Move / Rotate / Scale and the patterns take text along (Rotate moves the anchor; set the Angle
field to turn the letters).

Warnings and errors appear in the panel and in the status bar: *under 0.8 mm cap height the strokes are too thin*, *characters the
font does not have were skipped* (only Latin-1), *letters were moved apart*, *letters overlap on this radius*, and for a bad value
(empty string, height 0) what to change.

**Keep lettering in a sketch of its own.** Its loops are not trimmed against, merged with or made holes of the other curves of the
sketch. One sketch can hold several texts (a dial: one text per numeral).

## Engrave and emboss

* **Engrave**: finish the sketch, **Cut** with the engraving depth (0.1 to 0.5 mm is typical) into the face the sketch lies on.
* **Emboss**: finish the sketch, **Extrude** (add) the height. Starting the sketch a little above the face (offset plane) makes the
  lettering a body of its own, with its own name and colour in the Bodies list.
* The extrude / cut dialog lists the lettering as one region per text (`regions` takes the text entity id), so one text of a
  sketch can be cut and another embossed.

## Script

```js
part('Plate').sketch('front', (s) => s.rect(60, 20)).extrude(4)
  .sketch(at('front', 4), (s) => s.text('SEA SPRITE', [0, 0], { font: 'engrave', height: 5, anchor: ['center', 'middle'] })).cut(0.3);
```

`s.text(string, [x, y], { font, height, anchor, angle, spacing, mirror, arc, polyline, name })` and
`await part.textMetrics(string, { font, height, spacing })` are documented, with the dial and arc examples, in `docs/scripting.md`
(section Lettering). The speedboat dash (`docs/speedboat-dash.md`) uses them for its dial numerals, captions and nameplate.

## Fonts

Two fonts are compiled into the kernel (SIL OFL): `gauge` (Barlow Condensed) and `engrave` (PT Serif), Basic Latin and Latin-1
(including the degree sign). Nothing is read from the machine, so a part looks the same everywhere.

## Limits

Text is flat on a plane (no wrapping onto curved faces); one line per entity; no kerning, ligatures, bold or italic; at most 500
characters. In the editor the lettering outlines come from the kernel while a sketch is open; a closed sketch shows the extruded
or cut result, not the lettering curves.
