import type { JSX } from 'preact';

/** The icon set: every icon is hand-drawn SVG path data on a 24x24 grid. See docs/icons.md for the visual grammar.
 *
 *  Grammar in one breath: new geometry is a bold 1.75 stroke in currentColor; helper geometry is thin and dashed;
 *  points are small solid dots; "active" geometry may use one accent (--accent); constraints show their symbol. */

const P = (d: string) => `<path d="${d}"/>`;                                                  // bold geometry
const C = (d: string) => `<path d="${d}" stroke-width="1.15" stroke-dasharray="2 2" opacity=".7"/>`; // construction / helper
const T = (d: string) => `<path d="${d}" stroke-width="1.15" opacity=".5"/>`;                  // thin, solid, quiet context
const A = (d: string, w = 1.75) => `<path d="${d}" stroke-width="${w}" style="stroke:var(--accent,currentColor)"/>`; // accent
const AD = (d: string, w = 2) => `<path d="${d}" stroke-width="${w}" stroke-dasharray="2.4 2" style="stroke:var(--accent,currentColor)"/>`; // accent, hidden
const D = (x: number, y: number, r = 1.7) => `<circle cx="${x}" cy="${y}" r="${r}" fill="currentColor" stroke="none"/>`; // point
const AP = (x: number, y: number, r = 2) => `<circle cx="${x}" cy="${y}" r="${r}" style="fill:var(--accent,currentColor);stroke:none"/>`;
const O = (x: number, y: number, r: number) => `<circle cx="${x}" cy="${y}" r="${r}"/>`;      // bold circle
const AE = (x: number, y: number, rx: number, ry: number, rot: number) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" transform="rotate(${rot} ${x} ${y})" style="stroke:var(--accent,currentColor)"/>`;
const CO = (x: number, y: number, r: number) => `<circle cx="${x}" cy="${y}" r="${r}" stroke-width="1.15" stroke-dasharray="2 2" opacity=".7"/>`;

// Isometric cube (hexagon with the three visible faces) used by view, select and display icons.
const HEX = 'M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z';
const Y = 'M4.2 7.5 12 12l7.8-4.5M12 12v9';
const cube = (extra = '', hex = P(HEX) + T(Y)) => hex + extra;
const cubeDim = T(HEX) + T(Y);
const FACE = {
  top: 'M12 3l7.8 4.5L12 12 4.2 7.5z',
  front: 'M4.2 7.5 12 12v9l-7.8-4.5z',
  right: 'M19.8 7.5 12 12v9l7.8-4.5z',
  back: 'M12 3l7.8 4.5v9L12 12z',
  left: 'M12 3 12 12 4.2 16.5v-9z',
  bottom: 'M4.2 16.5 12 12l7.8 4.5L12 21z',
};

const plane = (d: string) => C(d);

const ICONS: Record<string, string> = {
  // ---- sketch: select and draw
  select: P('M6 3.5l12 7-5.2 1.6L10.4 17.5z') + P('M13 13l4.5 5'),
  line: P('M5 19 19 5') + D(5, 19) + D(19, 5),
  rectangle: P('M4 6h16v12H4z') + D(4, 6) + D(20, 18),
  'center-rectangle': P('M4 6h16v12H4z') + C('M4 6l16 12M20 6 4 18') + D(12, 12, 2),
  circle: O(12, 12, 8) + C('M12 12h8') + D(12, 12),
  'arc-centre': P('M6 6A12 12 0 0 1 18 18') + C('M6 18V6M6 18h12') + D(6, 18) + D(6, 6) + D(18, 18),
  'arc-three-point': P('M4 17A9 9 0 0 1 20 17') + D(4, 17) + D(12, 3.9) + D(20, 17),
  'arc-tangent': C('M2.5 19H10') + P('M10 19A8 8 0 0 0 18 11') + D(10, 19) + D(18, 11),
  ellipse: `<ellipse cx="12" cy="12" rx="9" ry="5.5" transform="rotate(-30 12 12)"/>` + C('M5 17 19 7') + D(12, 12),
  polygon: P('M20 12l-4 6.9H8L4 12l4-6.9h8z') + CO(12, 12, 8) + D(12, 12),
  slot: P('M7 8h10a4 4 0 010 8H7a4 4 0 010-8z') + C('M7 12h10') + D(7, 12) + D(17, 12),
  point: C('M12 3v5M12 16v5M3 12h5M16 12h5') + D(12, 12, 2.6),
  centerline: `<path d="M3.5 20.5 20.5 3.5" stroke-dasharray="7 2.5 1.5 2.5"/>`,
  spline: P('M3 16C7 4 11 4 12 12s5 8 9-4') + D(3, 16) + D(12, 12) + D(21, 8),
  cvspline: C('M4 18 8 5l8 0 4 13') + P('M4 18C8 5 16 5 20 18') + D(4, 18) + D(8, 5) + D(16, 5) + D(20, 18),
  bridge: C('M2.5 19H8M16 5h5.5') + P('M8 19C13 19 11 5 16 5') + D(8, 19) + D(16, 5),
  // ---- sketch: dimension and constraints
  dimension: T('M5 5v14M19 5v14') + P('M5 12h14M8.5 9 5 12l3.5 3M15.5 9 19 12l-3.5 3'),
  horizontal: P('M3 11h18') + D(3, 11) + D(21, 11) + C('M3 18h18'),
  vertical: P('M13 3v18') + D(13, 3) + D(13, 21) + C('M6 3v18'),
  coincident: P('M4 5l8 10M20 5l-8 10') + O(12, 15, 4.5) + D(12, 15, 2),
  equal: P('M5 9h14M5 15h14'),
  parallel: P('M7 20 13 4M14 20 20 4'),
  perpendicular: P('M4 19h16M12 19V5') + T('M12 14.5h4.5V19'),
  collinear: P('M3 17l7.3-4.8M13.7 9.8 21 5') + C('M10.3 12.2l3.4-2.4') + D(3, 17) + D(21, 5),
  midpoint: P('M3 18 21 6') + O(12, 12, 4.4) + D(12, 12, 2),
  tangent: O(12, 11, 7) + P('M3 18h18') + D(12, 18, 2),
  symmetric: C('M12 3v18') + P('M9 5 5 12l4 7M15 5l4 7-4 7') + D(5, 12) + D(19, 12),
  fix: P('M5 11h14v9H5z') + P('M8 11V8a4 4 0 018 0v3') + D(12, 15.5),
  concentric: O(12, 12, 8.5) + O(12, 12, 4) + D(12, 12, 1.4),
  // ---- sketch: edit
  fillet: C('M4 12v8h8') + P('M4 4v8a8 8 0 008 8h8'),
  chamfer: C('M4 11v9h9') + P('M4 4v7l9 9h7'),
  trim: P('M12 3v18') + P('M3 12h9') + C('M12 12h9') + `<path d="m15.5 9 5 6M20.5 9l-5 6" stroke-width="1.5"/>`,
  mirror: C('M12 3v18') + P('M9.5 5 4 12l5.5 7z') + C('M14.5 5 20 12l-5.5 7z'),
  // ---- files and edit
  open: P('M3 7.5A1.5 1.5 0 014.5 6H9l2 2.5h8a1.5 1.5 0 011.5 1.5V18a1.5 1.5 0 01-1.5 1.5h-15A1.5 1.5 0 013 18z'),
  save: P('M5 4h11l3 3v13H5z') + P('M8 4v5h7V4') + P('M8 20v-6h8v6'),
  undo: P('M9 6 4.5 10.5 9 15') + P('M4.5 10.5H14a5.5 5.5 0 010 11H8'),
  redo: P('M15 6l4.5 4.5L15 15') + P('M19.5 10.5H10a5.5 5.5 0 000 11h6'),
  samples: P('M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4z') + A('M13 13h7v7h-7z'),
  palette: O(10.5, 10.5, 6.5) + P('M15.3 15.3 20.5 20.5'),
  drawer: P('M3.5 5h17v14h-17z') + P('M3.5 14h17') + P('M10 17h4'),
  settings: P('M4 7h6M14 7h6M4 12h2M10 12h10M4 17h9M17 17h3') + O(12, 7, 2) + O(8, 12, 2) + O(15, 17, 2),
  display: P('M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z') + O(12, 12, 3),
  // ---- views: the cube with the looked-at face outlined in the accent (dashed when it is behind the cube)
  'view-iso': cube('', P(HEX) + P(Y)),
  'view-top': cube(A(FACE.top, 2.25)),
  'view-front': cube(A(FACE.front, 2.25)),
  'view-right': cube(A(FACE.right, 2.25)),
  'view-back': cube(AD(FACE.back)),
  'view-left': cube(AD(FACE.left)),
  'view-bottom': cube(AD(FACE.bottom)),
  fit: P('M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4') + P('M9.5 9.5h5v5h-5z'),
  // ---- features
  'new-part': P('M10 6.5l6.5 3.75v7.5L10 21.5l-6.5-3.75v-7.5z') + T('M3.5 10.25 10 14l6.5-3.75M10 14v7.5') + A('M19 2.5v7M15.5 6h7'),
  'add-extrude': P('M3 14h11v7H3z') + P('M3 14l4-4h11l-4 4') + P('M14 14l4-4v7l-4 4') + A('M10.5 9V2.5M8 5l2.5-2.5L13 5'),
  'add-cut': P('M3 14h11v7H3z') + P('M3 14l4-4h11l-4 4') + P('M14 14l4-4v7l-4 4') + C('M7.5 13.5l2-2h3.5l-2 2z') + A('M10.5 2.5V9M8 6.5 10.5 9 13 6.5'),
  'sketch-new-top': plane('M12 4l9 5.5-9 5.5-9-5.5z') + AE(12, 9.5, 3.8, 2.1, 0) + D(12, 9.5, 1),
  'sketch-new-front': plane('M3 6l9 5.5v9L3 15z') + AE(7.5, 13.2, 2.4, 2.4, 0) + D(7.5, 13.2, 1),
  'sketch-new-right': plane('M21 6l-9 5.5v9l9-5.5z') + AE(16.5, 13.2, 2.4, 2.4, 0) + D(16.5, 13.2, 1),
  'sketch-on-face': cubeDim + A(FACE.top, 2) + '<ellipse cx="12" cy="7.5" rx="3" ry="1.7"/>',
  'add-fillet': P('M4 20V10M10 4h10v16H4') + A('M4 10a6 6 0 016-6') + C('M4 20h16'),
  'add-chamfer': P('M4 20V12M12 4h8v16H4') + A('M4 12 12 4') + C('M4 20h16'),
  'add-shell': P(HEX) + C('M12 8.5l4.4 2.5v5L12 18.5 7.6 16v-5z') + A(FACE.top, 2),
  'add-hole': P('M3 9l9-5 9 5-9 5z') + P('M3 9v6l9 5 9-5V9') + AE(12, 9, 3.4, 1.9, 0) + C('M12 11v8'),
  'add-revolve': C('M12 3v18') + P('M12 6h5.5l2 3.5v5l-2 3.5H12') + A('M5 9.5c1.2-1.2 3-1.9 5-2M5 14.5c1.6 1.6 4.2 2.4 7 2.4'),
  'add-lpattern': P('M3 8h5v8H3z') + T('M10 8h5v8h-5z') + T('M17 8h4v8h-4z') + A('M4 20h15M16.5 18l2.5 2-2.5 2'),
  'add-cpattern': CO(12, 12, 7.5) + O(12, 4.5, 2) + T('M20 16.5a2 2 0 11-4 0 2 2 0 014 0z') + T('M8 16.5a2 2 0 11-4 0 2 2 0 014 0z') + A('M12 12 12 6.5'),
  // ---- selection modes
  'sel-face': cubeDim + A(FACE.top, 2) + AP(12, 7.5, 1.8),
  'sel-edge': cubeDim + A('M12 12v9', 2.5) + AP(12, 12, 1.8) + AP(12, 21, 1.8),
  'sel-vertex': cubeDim + AP(12, 12, 3),
  // ---- display layers
  'layer-edges': P(HEX) + P(Y),
  'layer-hidden': P(HEX) + C('M4.2 7.5 12 12l7.8-4.5M12 12v9'),
  'layer-sketches': P('M4 13V6h9v7z') + O(15, 15, 5) + D(4, 13, 1.4),
  'layer-curves': P('M3 17C8 17 7 6 12 6s4 11 9 11') + D(3, 17) + D(21, 17),
  'layer-planes': C('M12 4l9 5-9 5-9-5z') + P('M12 8l4.5 2.5L12 13l-4.5-2.5z') + T('M3 14l9 5 9-5'),
  'layer-axes': P('M6 18h14M6 18V4M6 18l-3 3') + D(6, 18, 2),
  'layer-relations': P('M5 8h5M5 12h5') + P('M14 20 18 8M17 20l4-12') + C('M4 18h6'),
};

export const ICON_NAMES: string[] = Object.keys(ICONS);
export const hasIcon = (name: string): boolean => Object.prototype.hasOwnProperty.call(ICONS, name);

/** The neutral square drawn for a name that has no icon: dashed, so a missing icon is visible but harmless. */
const PLACEHOLDER = '<rect x="5" y="5" width="14" height="14" rx="2" stroke-dasharray="3 2.5" opacity=".6"/>';

/** One icon. `name` is a sketch tool id or a command id; `size` is the pixel size (default 20). Unknown names draw a
 *  placeholder and never throw. The icon is decorative (aria-hidden): the button that holds it carries the label. */
export function Icon(p: { name: string; size?: number; class?: string }): JSX.Element {
  const size = p.size ?? 20;
  return (
    <svg
      class={'icon' + (p.class ? ' ' + p.class : '')}
      data-icon={hasIcon(p.name) ? p.name : 'placeholder'}
      viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
      stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"
      dangerouslySetInnerHTML={{ __html: hasIcon(p.name) ? ICONS[p.name] : PLACEHOLDER }}
    />
  );
}
