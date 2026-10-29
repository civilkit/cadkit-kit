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
  triball: O(12, 12, 8.5) + P('M12 12l-4.2 3.4M12 12l4.4 2.2M12 12V7') + AP(12, 12, 2) + D(7.8, 15.4, 1.5) + D(16.4, 14.2, 1.5) + D(12, 7, 1.5),
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
  text: P('M6 6h12M12 6v13M9.5 19h5') + C('M4 6v13'),
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
  project: T('M4 4h16v6H4z') + C('M8 10v6M16 10v6') + P('M5 20h14') + D(8, 16, 1.4) + D(16, 16, 1.4),
  'pattern-linear': P('M3 8h5v8H3z') + T('M10 8h5v8h-5z') + C('M17 8h4v8h-4z') + C('M3 20h18'),
  'pattern-circular': P('M10 3h4v4h-4z') + T('M17.5 10.5h4v4h-4z') + T('M3 14.5h4v-4H3z') + C('M12 21a7.5 7.5 0 100-10') + D(12, 13, 1.4),
  move: T('M4 14h7v6H4z') + P('M13 4h7v6h-7z') + A('M8 12 16 12M13.5 9.5 16 12l-2.5 2.5') + D(8, 12, 1.4),
  copy: P('M4 11h8v9H4z') + T('M12 4h8v9h-8z') + C('M12 4v7M12 13h8') + A('M12 12h-1'),
  rotate: P('M4 8h7v6H4z') + C('M12 21a8 8 0 100-14') + A('M12 4l3 3-3 3') + D(12, 14, 1.4),
  scale: P('M4 14h6v6H4z') + C('M4 20 20 4') + T('M13 4h7v7h-7z') + A('M12 12 18 6M15 6h3v3'),
  'fully-define': P('M4 5h16v14H4z') + A('M8 12l3 3 5-6') + D(4, 5) + D(20, 5) + D(4, 19) + D(20, 19),
  construction: P('M4 20 12 12') + C('M12 12 20 4') + D(4, 20) + D(20, 4),
  offset: T('M4 20V9a5 5 0 015-5h11') + P('M9 20v-8a3 3 0 013-3h8') + C('M4 20h5'),
  extend: P('M19 3v18') + P('M3 12h6') + C('M9 12h10') + `<path d="m13 9 3.5 3-3.5 3" stroke-width="1.5"/>`,
  mirror: C('M12 3v18') + P('M9.5 5 4 12l5.5 7z') + C('M14.5 5 20 12l-5.5 7z'),
  // ---- files and edit
  open: P('M3 7.5A1.5 1.5 0 014.5 6H9l2 2.5h8a1.5 1.5 0 011.5 1.5V18a1.5 1.5 0 01-1.5 1.5h-15A1.5 1.5 0 013 18z'),
  save: P('M5 4h11l3 3v13H5z') + P('M8 4v5h7V4') + P('M8 20v-6h8v6'),
  undo: P('M9 6 4.5 10.5 9 15') + P('M4.5 10.5H14a5.5 5.5 0 010 11H8'),
  redo: P('M15 6l4.5 4.5L15 15') + P('M19.5 10.5H10a5.5 5.5 0 000 11h6'),
  'repeat-last': P('M19.5 12a7.5 7.5 0 10-2.2 5.3') + P('M19.5 5.5V12H13'),
  samples: P('M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4z') + A('M13 13h7v7h-7z'),
  // ---- import and export: a page for a drawing file, the cube for a solid, an accent arrow for the direction
  'sketch-import-dxf': P('M6 3h8l4 4v14H6z') + T('M14 3v4h4') + A('M9.5 17.5 12 12.5l2.5 5z'),
  'sketch-from-dxf': C('M3 20l4-5h14l-4 5z') + P('M8 3h6l3 3v8H8z') + A('M12 8.5v3.5M10.2 10.5 12 12.3l1.8-1.8'),
  export: P('M5 14v6h14v-6') + A('M12 15V4M8 8l4-4 4 4'),
  'export-stl': P(HEX) + T(Y) + C('M12 3 4.2 16.5M19.8 7.5 12 21'),
  'export-stl-ascii': P('M4.2 7.5 12 3l7.8 4.5v4M4.2 7.5v9L12 21') + T('M4.2 7.5 12 12l7.8-4.5M12 12v9') + A('M14.5 15h6M14.5 18h6M14.5 21h4'),
  'export-obj': P(HEX) + T(Y) + D(12, 3) + D(19.8, 7.5) + D(19.8, 16.5) + D(12, 21) + D(4.2, 16.5) + D(4.2, 7.5) + D(12, 12),
  'export-step': P(HEX) + T(Y) + A('M12 12 19.8 7.5M12 12 4.2 7.5M12 12v9', 2.25),
  'export-dxf-sketch': P('M6 3h8l4 4v14H6z') + T('M14 3v4h4') + O(11, 14, 2.5) + A('M8.5 18.5 16 18.5'),
  'export-dxf-views': P('M4 11h10v9H4z') + P('M4 4h10v5H4z') + P('M16 11h5v9h-5z') + A('M4 9v2M14 9v2', 1.15),
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
  'toggle-up-axis': P('M12 4v16') + T('M8 8l4-4 4 4M12 20l7-4M12 20l-7-4'),
  'toggle-projection': P('M4 8l8-3 8 3v8l-8 3-8-3z') + T('M4 8l8 3 8-3M12 11v8'),
  'projection-ortho': P('M5 7h14v10H5z') + T('M8 7v10M16 7v10') + A('M5 7l3-3h11v10l-3 3'),
  'toggle-left-panel': P('M4 5h16v14H4z') + T('M9.5 5v14') + A('M15 9.5 12.5 12l2.5 2.5'),
  'reset-layout': P('M4 5h16v14H4z') + T('M9.5 5v14M4 12h5.5') + A('M13 10l2 2-2 2M19 10v4'),
  'sketch-on-face': cubeDim + A(FACE.top, 2) + '<ellipse cx="12" cy="7.5" rx="3" ry="1.7"/>',
  'add-fillet': P('M4 20V10M10 4h10v16H4') + A('M4 10a6 6 0 016-6') + C('M4 20h16'),
  'add-chamfer': P('M4 20V12M12 4h8v16H4') + A('M4 12 12 4') + C('M4 20h16'),
  'add-shell': P(HEX) + C('M12 8.5l4.4 2.5v5L12 18.5 7.6 16v-5z') + A(FACE.top, 2),
  'open-script': P('M8.5 7.5 4 12l4.5 4.5M15.5 7.5 20 12l-4.5 4.5') + C('M13.5 6 10.5 18'),
  'open-variables': P('M17.5 5H7.5l5 7-5 7h10'),
  'open-catalog': P('M3.5 4h7v7h-7z') + O(17, 7.5, 3.5) + P('M3.5 20l3.5-6 3.5 6z') + P('M14 14h6.5v6.5H14z') + C('M14 17.2h6.5'),
  'add-hole': P('M3 9l9-5 9 5-9 5z') + P('M3 9v6l9 5 9-5V9') + AE(12, 9, 3.4, 1.9, 0) + C('M12 11v8'),
  'add-gear': P('M10 3h4l.6 2.4 1.7.7 2.1-1.3 2.8 2.8-1.3 2.1.7 1.7L21 10v4l-2.4.6-.7 1.7 1.3 2.1-2.8 2.8-2.1-1.3-1.7.7L14 21h-4l-.6-2.4-1.7-.7-2.1 1.3-2.8-2.8 1.3-2.1-.7-1.7L3 14v-4l2.4-.6.7-1.7-1.3-2.1 2.8-2.8 2.1 1.3 1.7-.7z') + O(12, 12, 3.2),
  'add-propeller': P('M12 9.6C10.2 7 10.3 4.2 12 3.2C13.7 4.2 13.8 7 12 9.6Z') + P('M14.1 13.2C17.2 12.9 19.6 14.4 19.6 16.4C17.9 17.4 15.4 16.1 14.1 13.2Z') + P('M9.9 13.2C8.6 16.1 6.1 17.4 4.4 16.4C4.4 14.4 6.8 12.9 9.9 13.2Z') + O(12, 12, 1.6),
  'add-knurl': P('M6 6c0-1.4 2.7-2.5 6-2.5s6 1.1 6 2.5-2.7 2.5-6 2.5S6 7.4 6 6z') + P('M6 6v12c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V6') + T('M8.2 10.5l7.6 7M8.2 14l7.6 5.6M15.8 10.5l-7.6 7M15.8 14l-7.6 5.6'),
  'add-screw': P('M5 4h14v3H5z') + P('M10 7h4v11l-2 3-2-3z') + T('M10 10l4 1.2M10 13l4 1.2M10 16l4 1.2'),
  'add-bearing': O(12, 12, 9) + O(12, 12, 4.2) + O(12, 4.6, 1.4) + O(12, 19.4, 1.4) + O(4.6, 12, 1.4) + O(19.4, 12, 1.4),
  'add-impeller': P('M12 9.6C10.2 7 10.3 4.2 12 3.2C13.7 4.2 13.8 7 12 9.6Z') + P('M14.1 13.2C17.2 12.9 19.6 14.4 19.6 16.4C17.9 17.4 15.4 16.1 14.1 13.2Z') + P('M9.9 13.2C8.6 16.1 6.1 17.4 4.4 16.4C4.4 14.4 6.8 12.9 9.9 13.2Z') + O(12, 12, 1.6),
  'add-gear-pair': P('M7 6.5l1.2.4.5 1 1.1-.2.8.8-.2 1.1 1 .5.4 1.2v1.1l-1.2.4-.5 1 .2 1.1-.8.8-1.1-.2-.5 1-1.2.4H6l-.4-1.2-1-.5-1.1.2-.8-.8.2-1.1-1-.5L2 12.6v-1.1l1.2-.4.5-1-.2-1.1.8-.8 1.1.2.5-1L6.4 6.5z') + O(6.5, 12, 2) + P('M17 11l1 .35.45.9 1-.2.7.7-.2 1 .9.45.35 1v1l-1 .35-.45.9.2 1-.7.7-1-.2-.45.9-1 .35h-1l-.35-1-.9-.45-1 .2-.7-.7.2-1-.9-.45L11 17.5v-1l1-.35.45-.9-.2-1 .7-.7 1 .2.45-.9 1-.35z') + O(15.5, 16.2, 1.5),
  'add-thread': P('M8 3h8v18H8z') + T('M8 7l8 2M8 11l8 2M8 15l8 2M8 19l8 2'),
  // thread hand: a vertical axis with the flank lines rising to the right (right hand) or to the left; thread ends: arrows up / down, an open mouth
  'helix-right': C('M12 3v18') + P('M6 8l12-3M6 13l12-3M6 18l12-3'),
  'helix-left': C('M12 3v18') + P('M18 8 6 5M18 13 6 10M18 18 6 15'),
  'arrow-up': P('M12 19V5M6 11l6-6 6 6'),
  'arrow-down': P('M12 5v14M6 13l6 6 6-6'),
  'end-open': P('M7 9v11h10V9') + C('M7 9h10') + A('M12 3v8M9 8l3 3 3-3'),
  'add-revolve': C('M12 3v18') + P('M12 6h5.5l2 3.5v5l-2 3.5H12') + A('M5 9.5c1.2-1.2 3-1.9 5-2M5 14.5c1.6 1.6 4.2 2.4 7 2.4'),
  'add-lpattern': P('M3 8h5v8H3z') + T('M10 8h5v8h-5z') + T('M17 8h4v8h-4z') + A('M4 20h15M16.5 18l2.5 2-2.5 2'),
  'add-cpattern': CO(12, 12, 7.5) + O(12, 4.5, 2) + T('M20 16.5a2 2 0 11-4 0 2 2 0 014 0z') + T('M8 16.5a2 2 0 11-4 0 2 2 0 014 0z') + A('M12 12 12 6.5'),
  // ---- selection modes
  'sel-face': cubeDim + A(FACE.top, 2) + AP(12, 7.5, 1.8),
  'sel-edge': cubeDim + A('M12 12v9', 2.5) + AP(12, 12, 1.8) + AP(12, 21, 1.8),
  'sel-vertex': cubeDim + AP(12, 12, 3),
  'sel-body': A(HEX, 2) + T(Y),
  'sel-box': '<rect x="3.5" y="5" width="17" height="14" rx="1" stroke-width="1.5" stroke-dasharray="3 2" style="stroke:var(--accent,currentColor)"/>' + D(9, 12) + D(15, 12),
  'sel-filter': P('M4 5h16l-6.2 7.6V19l-3.6-1.8v-4.6z'),
  'select-tangent': cubeDim + A('M5 15c4 0 4-6 8-6h6', 2.2),
  'select-parallel': cubeDim + A('M6 19L14 5M11 21L19 7', 2),
  'select-similar': cubeDim + A('M4.5 18h6v-6h-6zM13.5 12h6v-6h-6z', 1.8),
  'select-loop': cubeDim + A('M12 3l7.8 4.5L12 12 4.2 7.5z', 2.4),
  'select-connected': cubeDim + A('M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z', 2),
  'select-invert': cubeDim + A(FACE.top, 2) + P('M12 12l7.8-4.5v9L12 21z'),
  'select-none': cubeDim + P('M8 8l8 8M16 8l-8 8'),
  'show-in-tree': cubeDim + P('M14 6h6M14 12h6M14 18h6') + A('M6 12h5M9 9l3 3-3 3', 2),
  'design-check': P(HEX) + T(Y) + A('M8.5 11.5l2.5 2.5 5-5', 2),
  // ---- display layers
  'layer-edges': P(HEX) + P(Y),
  'layer-hidden': P(HEX) + C('M4.2 7.5 12 12l7.8-4.5M12 12v9'),
  'layer-sketches': P('M4 13V6h9v7z') + O(15, 15, 5) + D(4, 13, 1.4),
  'layer-curves': P('M3 17C8 17 7 6 12 6s4 11 9 11') + D(3, 17) + D(21, 17),
  'layer-planes': C('M12 4l9 5-9 5-9-5z') + P('M12 8l4.5 2.5L12 13l-4.5-2.5z') + T('M3 14l9 5 9-5'),
  'layer-issues': P(HEX) + T(Y) + A(FACE.top, 2) + D(12, 7.5, 1.4),
  'layer-threads': P('M7 3v18M17 3v18') + T('M7 6l10 2M7 10l10 2M7 14l10 2M7 18l10 2'),
  'layer-dimensions': P('M3 7v10M21 7v10') + P('M3 12h18') + T('M3 12l3-2.2M3 12l3 2.2M21 12l-3-2.2M21 12l-3 2.2'),
  'layer-grid': P('M4 4h16v16H4z') + T('M4 9.3h16M4 14.7h16M9.3 4v16M14.7 4v16'),
  'layer-axes': P('M6 18h14M6 18V4M6 18l-3 3') + D(6, 18, 2),
  // history tree and feature editor
  'edit': P('M5 19l1-4L16.5 4.5a2 2 0 0 1 3 3L9 18z') + T('M14.5 6.5l3 3'),
  'eye': P('M2.5 12C5 7.5 8.5 5.5 12 5.5s7 2 9.5 6.5C19 16.5 15.5 18.5 12 18.5S5 16.5 2.5 12z') + O(12, 12, 3),
  'eye-off': P('M2.5 12C5 7.5 8.5 5.5 12 5.5s7 2 9.5 6.5C19 16.5 15.5 18.5 12 18.5S5 16.5 2.5 12z') + T('M4 4l16 16'),
  'isolate': P('M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4') + A('M12 8.5l3.5 3.5-3.5 3.5-3.5-3.5z'),
  'pause': P('M9 5.5v13') + P('M15 5.5v13'),
  'trash': P('M5 7h14M9 7V4.5h6V7M7 7l1 13h8l1-13') + T('M10.5 11v6M13.5 11v6'),
  'check': P('M5 12.5l4.5 4.5L19 7'),
  'close': P('M6 6l12 12M18 6 6 18'),
  'chevron': P('M9 6l6 6-6 6'),
  'search': O(10.5, 10.5, 5.5) + P('M14.6 14.6 20 20'),
  'folder': P('M3.5 7.5V18h17V9H11L9.5 7z'),
  'group-selected': P('M3.5 7.5V18h17V9H11L9.5 7z') + T('M12 11v5M9.5 13.5h5'),
  'folder-open': P('M3.5 7.5V18h15.5l2-8H8.5L6.8 13.6M3.5 7.5H9l1.5 2'),
  'ref-origin': D(12, 16, 2) + A('M12 16V5') + P('M12 16l8 3.5') + T('M12 16l-6 3'),
  'ref-material': O(12, 12, 8) + T('M12 4a8 8 0 0 1 0 16') + T('M7 12h10'),
  'feature-part': P(HEX) + T(Y),
  'feature-sphere': '<circle cx="12" cy="12" r="8"/>' + AE(12, 12, 8, 3, 0),
  'sketch-here': P('M4 18h12V8H4z') + A('M14 6l4-2.5 2.5 3.5L16.5 9.5z') + T('M16 18l4-3'),
  'feature-sketch-point': P('M4 18h12V8H4z') + D(10, 13, 2.2) + T('M16 18l4-3'),
  'feature-sketch': P('M4 18h12V8H4z') + A('M14 6l4-2.5 2.5 3.5L16.5 9.5z') + T('M16 18l4-3'),
  'feature-plane': P('M3 15l9-5 9 5-9 5z') + C('M12 4v6'),
  'feature-generic': P('M5 5h14v14H5z') + T('M9 9h6M9 12h6M9 15h3'),
  'feature-draft': P('M5 20V8l7-4 7 4v12z') + A('M5 20 19 8'),
  'feature-rib': P('M3 18h18') + P('M7 18V9h10v9') + A('M12 9V4'),
  'feature-mirror': P('M4 7l6 3v7l-6-3z') + P('M20 7l-6 3v7l6-3z') + C('M12 4v16'),
  'feature-knit': P('M4 8h16v8H4z') + A('M4 12h16') + T('M9 8v8M15 8v8'),
  'feature-surface': P('M3 17C7 9 11 15 15 9s4-2 6-1') + T('M3 20h18'),
  'feature-pattern': P('M3 8h4v8H3z') + P('M10 8h4v8h-4z') + T('M17 8h4v8h-4z'),
  'rollback': P('M4 17h16') + A('M12 14V5M8.5 8.5 12 5l3.5 3.5'),
  'layer-relations': P('M5 8h5M5 12h5') + P('M14 20 18 8M17 20l4-12') + C('M4 18h6'),
  // ---- feature creators (apps/cad/src/featureCreators.ts)
  'add-plane': P('M3 15l9-5 9 5-9 5z') + C('M3 9l9-5 9 5') + A('M12 10V4M9.5 6.5 12 4l2.5 2.5'),
  'add-axis': C('M5 19 19 5') + P('M7 12h10') + A('M12 5v14') + D(12, 12),
  'add-draft': P('M5 20V8l7-4 7 4v12z') + C('M3 20h18') + A('M5 20 19 8') + T('M9 20a4 4 0 00-1.2-2.8'),
  'add-rib': P('M3 19h18') + T('M3 19V9M21 19V9') + P('M8 19V10h3v9') + A('M9.5 10V5'),
  'add-lip': P('M4 16h16') + P('M4 16v-4h3v-3h10v3h3v4') + A('M7 9h10') + T('M4 20h16'),
  'add-mirror': P('M4 7l6 3v7l-6-3z') + P('M20 7l-6 3v7l6-3z') + C('M12 4v16') + A('M10.5 12h3M12 10.5 13.5 12 12 13.5'),
  'add-scale': P('M4 13h7v7H4z') + C('M4 4h16v16H4z') + A('M12 12l7-7M14.5 5H19v4.5'),
  'add-helix': P('M7 19c8 0 10-2 10-3.5S9 13 7 12.5') + P('M7 12.5c8 0 10-2 10-3.5S9 6.5 7 6') + A('M17 15.5v-6.5') + T('M7 19V6'),
  'add-pipe-cut': P('M3 9c4-3 14-3 18 0v6c-4 3-14 3-18 0z') + C('M3 12c4 3 14 3 18 0') + A('M12 5v8M9.5 10.5 12 13l2.5-2.5'),
  'add-delete-body': P(HEX) + T(Y) + A('M8 8l8 8M16 8l-8 8', 2),
  'add-delete-face': cubeDim + A(FACE.top, 2) + P('M9.5 6.2l5 2.6M14.5 6.2l-5 2.6'),
  'add-surface-planar': P('M4 16l5-9h11l-5 9z') + T('M4 16v3h11M20 7v3') + A('M9 7 4 16'),
  'add-surface-extrude': P('M4 18h12M4 18C4 13 8 11 12 11s8 2 8 7') + T('M4 18v3h16v-3') + A('M12 11V3M9.5 5.5 12 3l2.5 2.5'),
  'add-surface-revolve': C('M12 3v18') + P('M12 6c4 0 7 1.5 7 4s-3 4-7 4') + T('M12 14c4 0 7 1.5 7 4') + A('M5 10c1.2-1.5 3.5-2.4 7-2.4'),
  'add-trim-surface': P('M3 17C7 9 11 15 21 8') + C('M12 3v18') + A('M12 12.5 21 8') + D(12, 12.5),
  'add-knit': P('M4 8h7v8H4z') + P('M13 8h7v8h-7z') + A('M11 9.5v5M13 9.5v5') + T('M4 12h7M13 12h7'),
  'add-thicken': P('M3 14C8 8 13 14 21 9') + P('M3 18C8 12 13 18 21 13') + T('M3 14v4M21 9v4') + A('M12 9v3M10.5 10.5 12 9l1.5 1.5'),
  'add-loft': P('M4 19c0-1 3-2 6-2s6 1 6 2-3 2-6 2-6-1-6-2z') + P('M12 7h8v4h-8z') + A('M4 19 12 7M16 19l4-8') + T('M10 17v-3'),
  'add-sweep': P('M4 19c0-1.5 2-2.5 4-2.5s4 1 4 2.5-2 2.5-4 2.5-4-1-4-2.5z') + A('M8 16.5C8 9 12 8 20 5') + T('M12 18.5C13 11 16 10 21 8') + D(20, 5),
  'add-surface-loft': P('M4 18h7M13 8h7') + A('M4 18C6 12 11 12 13 8M11 18c2-6 7-6 9-10') + T('M7.5 15c2-1 4-3 5-5'),
  'add-fill': P('M4 6h16v12H4z') + T('M4 6l16 12M20 6 4 18') + A('M12 9.5 14.5 12 12 14.5 9.5 12z') + D(12, 12, 1.3),
  'add-extend': P('M4 17l4-9h7l-4 9z') + C('M15 8h5l-4 9h-5') + A('M14 17h6M18 15l2 2-2 2'),
  'analysis-zebra': P('M4 6h16M4 10h16M4 14h16M4 18h16') + T('M3 4v16M21 4v16') + A('M6 20C9 8 15 8 18 4'),
  'analysis-gaussian': O(12, 12, 8) + T('M6 9c3 2 9 2 12 0M5 14c4 3 10 3 14 0') + A('M9 7l6 10') + D(12, 12, 1.6),
  'analysis-mean': O(12, 12, 8) + T('M4 12h16') + A('M7 8c3 3 7 3 10 0') + A('M7 16c3-3 7-3 10 0'),
  'analysis-draft': P('M7 20V9l5-5 5 5v11z') + C('M12 4v16') + A('M7 9 4 6M17 9l3-3') + T('M3 20h18'),
  'analysis-comb': P('M3 17C8 17 9 7 12 7s4 10 9 10') + A('M5 17l-.5 3M8 15l-1 4M10.5 11l-1.5 4M12 7V3M14 11l1.5 4M16 15l1 4M19 17l.5 3'),
  // ---- evaluate: measure, mass, interference, section
  measure: P('M4 17 17 4l3 3L7 20z') + T('M8 13l2 2M11 10l2 2M14 7l2 2') + D(4, 20),
  'mass-props': P('M5 20h14l-2.5-9h-9z') + O(12, 7.5, 2.5) + A('M12 11v4'),
  interference: O(9.5, 12, 6.5) + A('M15 6.3a6.5 6.5 0 0 1 0 11.4a6.5 6.5 0 0 1 0-11.4z'),
  // ---- assembly
  'insert-part': P('M4 14h10v6H4z') + P('M14 5h6v6h-6z') + T('M14 20h6v-6') + A('M9 13V8h4M11 6l2 2-2 2'),
  mate: P('M3 9h8v8H3z') + P('M13 7h8v8h-8z') + A('M11 13h2') + C('M7 9V5M17 15v4'),
  bom: P('M5 4h14v16H5z') + T('M5 9h14M5 14h14M10 4v16') + A('M12 11.5h4M12 17h4'),
  explode: P('M9 9h6v6H9z') + A('M12 7V3M10.5 4.5 12 3l1.5 1.5M12 17v4M10.5 19.5 12 21l1.5-1.5M7 12H3M4.5 10.5 3 12l1.5 1.5M17 12h4M19.5 10.5 21 12l-1.5 1.5'),
  'asm-interference': O(9.5, 12, 6.5) + A('M15 6.3a6.5 6.5 0 0 1 0 11.4a6.5 6.5 0 0 1 0-11.4z'),
  'section-view': cube('', P('M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z')) + AD('M3 13.5 12 9l9 4.5'),
  // ---- added by the icon audit: files, history, selection, display style, lighting, background
  'save-as': P('M5 4h9l4 4v12H5z') + P('M8 4v4h5V4') + A('M15.5 21.5l1-3.5 5-5 2.5 2.5-5 5z', 1.5),
  'embed-geometry': P('M5 5h10l4 4v10H5z') + C('M15 5v4h4') + A('M12 10l-4 2.2 4 2.2 4-2.2z', 1.6) + T('M8 14.6l4 2.2 4-2.2'),
  'recover-versions': P('M4 12a8 8 0 1 0 2.4-5.7') + A('M12 8v4l3 2', 1.75) + A('M3.5 4.5v4h4', 1.75),
  'import-step': P(HEX) + T(Y) + A('M12 1.8v7M9 6l3 3 3-3', 2),
  'rotate-skp': P(HEX) + T(Y) + A('M19 5.5a8 8 0 0 0-13 1M5 18.5a8 8 0 0 0 13-1M5.5 3.5v4h4M18.5 20.5v-4h-4', 1.75),
  'import-skp-hidden': P(HEX) + T(Y) + A('M12 1.8v7M9 6l3 3 3-3', 2),
  rename: P('M4 8h12v8H4z') + A('M19 5v14M17 5h4M17 19h4', 1.75) + D(7, 12, 1.2) + D(10, 12, 1.2) + D(13, 12, 1.2),
  'delete-feature': P('M5 5h14v14H5z') + T('M9 9h6M9 12h6M9 15h3') + A('M14 14l6 6M20 14l-6 6', 2),
  'suppress-selected': P('M5 5h14v14H5z') + T('M9 9h6M9 12h6M9 15h3') + A('M9 19.5 19 4.5', 2),
  rebuild: P('M19.5 8A8 8 0 006 6.5L4 9') + P('M4 4v5h5') + P('M4.5 16A8 8 0 0018 17.5L20 15') + P('M20 20v-5h-5'),
  'roll-forward': P('M4 17h16') + A('M12 5v10M8.5 11.5 12 15l3.5-3.5') + D(12, 5, 1.5),
  'select-all': cubeDim + A(FACE.top, 2) + A(FACE.front, 2) + A(FACE.right, 2),
  'select-body': A(HEX, 2) + T(Y) + D(12, 12, 1.8),
  'select-box': '<rect x="3.5" y="5" width="17" height="14" rx="1" stroke-width="1.5" stroke-dasharray="3 2" style="stroke:var(--accent,currentColor)"/>' + D(9, 12) + D(15, 12),
  'select-same-size': cubeDim + A('M5 18h5v-5H5zM14 11h5V6h-5z', 1.8) + T('M10 15.5h4M16.5 11v2.5'),
  // display styles: the cube drawn as it will look
  'style-shaded': P(HEX) + '<path d="M12 12l7.8-4.5v9L12 21z" fill="currentColor" stroke="none" opacity=".55"/>' + '<path d="M4.2 7.5 12 12v9l-7.8-4.5z" fill="currentColor" stroke="none" opacity=".25"/>',
  'style-shadedEdges': '<path d="M12 12l7.8-4.5v9L12 21z" fill="currentColor" stroke="none" opacity=".4"/>' + P(HEX) + P(Y),
  'style-wireframe': P(HEX) + P('M4.2 7.5 12 12l7.8-4.5M12 12v9') + C('M4.2 16.5l7.8-4.5 7.8 4.5'),
  'style-hiddenLines': P('M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z') + C('M4.2 7.5 12 12l7.8-4.5M12 12v9'),
  'style-ghost': C(HEX) + C(Y) + A('M6 12.5h12', 1.5) + T('M8 16h8'),
  'hide-selection': P('M2.5 12C5 7.5 8.5 5.5 12 5.5s7 2 9.5 6.5C19 16.5 15.5 18.5 12 18.5S5 16.5 2.5 12z') + O(12, 12, 3) + A('M4 4l16 16', 2),
  'show-all': P('M2.5 12C5 7.5 8.5 5.5 12 5.5s7 2 9.5 6.5C19 16.5 15.5 18.5 12 18.5S5 16.5 2.5 12z') + O(12, 12, 3) + A('M18 3.5v4M16 5.5h4', 1.75),
  // lighting: a lamp over the cube
  'light-studio': P('M12 3a5 5 0 013 9v2H9v-2a5 5 0 013-9z') + P('M10 17h4M10.5 20h3') + T('M3 6l2 1.5M21 6l-2 1.5M3 14l2-1M21 14l-2-1'),
  'light-flat': P('M5 8h14v8H5z') + T('M5 12h14') + A('M8 12h8', 1.75),
  'light-technical': O(12, 12, 8) + T('M4 12h16M12 4v16'),
  'light-contrast': O(12, 12, 8) + '<path d="M12 4a8 8 0 010 16z" fill="currentColor" stroke="none"/>',
  // background: a framed canvas
  'bg-theme': P('M4 5h16v14H4z') + A('M4 5l16 14', 1.75) + T('M4 5h16v14H4z'),
  'bg-light': P('M4 5h16v14H4z') + O(12, 12, 3) + T('M12 7v-1M12 18v-1M7 12H6M18 12h-1'),
  'bg-dark': P('M4 5h16v14H4z') + '<path d="M14.5 8.5a4 4 0 100 7 3.4 3.4 0 010-7z" fill="currentColor" stroke="none"/>',
  'bg-gradient': P('M4 5h16v14H4z') + T('M4 9h16M4 13h16') + '<path d="M4.9 15.5h14.2V18H4.9z" fill="currentColor" stroke="none" opacity=".45"/>',
  // thin wall (reserved ids: the commands are registered with the thin-wall feature): the profile curve with a thickened band
  'add-thin-extrude': P('M4 17c3-6 6-6 9-2s5 2 7-4') + P('M4 20c3-6 6-6 9-2s5 2 7-4') + T('M4 17v3M20 11v3') + A('M12 9V3M9.5 5.5 12 3l2.5 2.5'),
  'add-thin-cut': P('M4 17c3-6 6-6 9-2s5 2 7-4') + P('M4 20c3-6 6-6 9-2s5 2 7-4') + T('M4 17v3M20 11v3') + C('M9 12h6') + A('M12 3v6M9.5 6.5 12 9l2.5-2.5'),
  'add-thin-revolve': C('M12 3v18') + P('M12 8c4 0 6 1 7 4') + P('M12 11c3 0 4 .8 5 3') + T('M19 12l-2 2') + A('M5 9c1.2-1.2 3-1.9 5-2M5 15c1.6 1.6 4.2 2.4 7 2.4'),
  more: D(5.5, 12, 2.3) + D(12, 12, 2.3) + D(18.5, 12, 2.3),
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

/** The icon for a feature in the history tree: by kind, with a boss/cut distinction for extrudes. */
export function featureIconName(type: string, op?: string): string {
  const cut = op === 'cut';
  switch (type) {
    case 'sketch': return op === 'point' ? 'feature-sketch-point' : 'feature-sketch';
    case 'sketch3d': return 'feature-sketch';
    case 'plane': return 'feature-plane';
    case 'extrude': return cut ? 'add-cut' : 'add-extrude';
    case 'revolve': return 'add-revolve';
    case 'sphere': return 'feature-sphere';
    case 'fillet': return 'add-fillet';
    case 'chamfer': return 'add-chamfer';
    case 'shell': return 'add-shell';
    case 'hole': return 'add-hole';
    case 'thread': return 'add-thread';
    case 'gear': return 'add-gear';
    case 'lpattern': return 'add-lpattern';
    case 'cpattern': return 'add-cpattern';
    case 'curvepattern': case 'fillpattern': case 'spattern': return 'feature-pattern';
    case 'draft': return 'feature-draft';
    case 'rib': case 'lip': return 'feature-rib';
    case 'mirror': return 'feature-mirror';
    case 'knit': return 'feature-knit';
    case 'insertPart': case 'importStep': return 'feature-part';
    case 'surfacePlanar': case 'surfaceExtrude': case 'surfaceRevolve': case 'surfaceOffset': case 'trimSurface': case 'fill': case 'extend': case 'pipeCut':
    case 'sweep': case 'loft': case 'thicken': return 'feature-surface';
    default: return 'feature-generic';
  }
}
