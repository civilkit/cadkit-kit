# Icons and tooltips

All icons live in `packages/ui/src/icons.tsx`; use them with `<Icon name="line" size={20} />`. The tooltip is
`packages/ui/src/Tip.tsx`. Both are exported from `@kit/ui`.

## Sizes

- Drawn on a 24x24 grid, `viewBox="0 0 24 24"`, one stroke width of 1.75, round caps and joins.
- Shown at 20 px in icon-only buttons (34 px square) and at 16 px beside a text label. Check any new icon at both.
- Colour is `currentColor`. The only other colour allowed is the accent, written `var(--accent, currentColor)`.
  A pressed button (blue background) resets `--accent` to `currentColor`, so accent parts stay visible.

## Visual grammar

| Meaning | Drawing | Helper |
| --- | --- | --- |
| New / main geometry | bold 1.75 stroke | `P(d)` |
| Construction, helper, "to be removed" | thin (1.15), dashed, 70% | `C(d)` |
| Quiet context (the rest of a cube, the existing line) | thin, solid, 50% | `T(d)` |
| Point | small solid dot, r 1.7 | `D(x, y)` |
| The geometry the command acts on (face looked at, face picked, new body direction) | accent stroke | `A(d)`, `AP(x, y)` (dot) |
| Hidden / behind | dashed accent | `AD(d)` |
| Constraint | its symbol: `=` equal, `//` parallel, a corner mark for perpendicular, a circle touching a line for tangent, a padlock for fix, concentric rings, a dot on a line for midpoint | |

Views are the isometric cube with the viewed face outlined in the accent; faces behind the cube (back, left, bottom)
are dashed. No fills except the small dots.

## Adding an icon

1. Add an entry to the `ICONS` map in `icons.tsx`. The key is the id the UI already uses: a sketch tool id from
   `packages/sketch/src/registry.ts`, a command id from `apps/cad/src/commands.ts`, or `sel-<mode>`.
2. Build it from the helpers above; keep geometry inside 3..21 so strokes are not clipped.
3. `ICON_NAMES` updates itself. The tests in `icons.test.tsx` and `apps/cad/src/SketchToolStrip.test.tsx` fail when
   a registered tool or a command has no icon, and when an icon uses a literal colour.
4. Look at it at 16 and 20 px on the light and dark themes.

An unknown name renders a dashed placeholder square (`data-icon="placeholder"`) and never throws.

## Tooltip

`<Tip label={t('...')} keys="L"><button>...</button></Tip>` wraps one button. It shows at once on pointer-enter and
keyboard focus, hides on leave, blur and Escape, flips to the side that fits the viewport, shows `keys` as a badge,
and sets `aria-describedby` on the button while visible. On touch it shows on tap or long press and hides itself.
It draws on the page body, so scrolling toolbars cannot clip it. Do not also set `title`.

## Label mode

The workspace setting `toolLabels` (`'icons-and-text'` by default, or `'icons'`) is chosen in Settings. It drives the
sketch tool strip, the ribbon and the selection-mode bar. The tool rail is icon-only in both modes (it always was)
and gets the same instant tooltip.
