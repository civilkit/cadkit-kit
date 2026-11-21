// The help map's table: help topic -> guide page and heading anchor. The topic ids are `guide`, `sketch`, `sketch:<tool id>`, `sketch3d`,
// `feature:<feature type>` and `wizard:<id>`. The page is relative to the guide's root (the docs base, see helpMap.ts); the anchor is a heading
// id or an explicit `<a id>` in the guide source (helpMap.test.ts fails on one that does not exist). The strings are in locales/help.ts.
import { t } from './i18n';

export interface HelpEntry {
  /** Guide page, relative to the guide root, for example `sketching/tools.html`. */
  page: string;
  /** Heading or `<a id>` anchor on that page. */
  anchor?: string;
  /** An inline summary that replaces the catalogue's `help.<topic>.sum` (reserved for in-app help text that is not a translated sentence). */
  summary?: string;
}

export const HELP: Record<string, HelpEntry> = {
  'guide': { page: 'index.html' },
  'sketch': { page: 'sketching/tools.html', anchor: 'choosing-a-tool' },
  'sketch:select': { page: 'sketching/tools.html', anchor: 'select-and-edit-by-hand' },
  'sketch:line': { page: 'sketching/tools.html', anchor: 'tool-line' },
  'sketch:centerline': { page: 'sketching/tools.html', anchor: 'tool-centerline' },
  'sketch:arc-three-point': { page: 'sketching/tools.html', anchor: 'tool-arc-three-point' },
  'sketch:arc-centre': { page: 'sketching/tools.html', anchor: 'tool-arc-centre' },
  'sketch:arc-tangent': { page: 'sketching/tools.html', anchor: 'tool-arc-tangent' },
  'sketch:circle': { page: 'sketching/tools.html', anchor: 'tool-circle' },
  'sketch:ellipse': { page: 'sketching/tools.html', anchor: 'tool-ellipse' },
  'sketch:rectangle': { page: 'sketching/tools.html', anchor: 'tool-rectangle' },
  'sketch:rounded-rectangle': { page: 'sketching/tools.html', anchor: 'tool-rounded-rectangle' },
  'sketch:center-rectangle': { page: 'sketching/tools.html', anchor: 'tool-center-rectangle' },
  'sketch:slot': { page: 'sketching/tools.html', anchor: 'tool-slot' },
  'sketch:arc-slot': { page: 'sketching/tools.html', anchor: 'tool-arc-slot' },
  'sketch:polygon': { page: 'sketching/tools.html', anchor: 'tool-polygon' },
  'sketch:spline': { page: 'sketching/tools.html', anchor: 'tool-spline' },
  'sketch:cvspline': { page: 'sketching/tools.html', anchor: 'tool-cvspline' },
  'sketch:spline-add': { page: 'sketching/tools.html', anchor: 'tool-spline-add' },
  'sketch:bridge': { page: 'sketching/tools.html', anchor: 'tool-bridge' },
  'sketch:equation': { page: 'sketching/tools.html', anchor: 'tool-equation' },
  'sketch:point': { page: 'sketching/tools.html', anchor: 'tool-point' },
  'sketch:text': { page: 'sketching/tools.html', anchor: 'tool-text' },
  'sketch:dimension': { page: 'sketching/constraints.html', anchor: 'tool-dimension' },
  'sketch:horizontal': { page: 'sketching/constraints.html', anchor: 'tool-horizontal' },
  'sketch:vertical': { page: 'sketching/constraints.html', anchor: 'tool-vertical' },
  'sketch:coincident': { page: 'sketching/constraints.html', anchor: 'tool-coincident' },
  'sketch:midpoint': { page: 'sketching/constraints.html', anchor: 'tool-midpoint' },
  'sketch:fix': { page: 'sketching/constraints.html', anchor: 'tool-fix' },
  'sketch:equal': { page: 'sketching/constraints.html', anchor: 'tool-equal' },
  'sketch:parallel': { page: 'sketching/constraints.html', anchor: 'tool-parallel' },
  'sketch:perpendicular': { page: 'sketching/constraints.html', anchor: 'tool-perpendicular' },
  'sketch:collinear': { page: 'sketching/constraints.html', anchor: 'tool-collinear' },
  'sketch:tangent': { page: 'sketching/constraints.html', anchor: 'tool-tangent' },
  'sketch:concentric': { page: 'sketching/constraints.html', anchor: 'tool-concentric' },
  'sketch:symmetric': { page: 'sketching/constraints.html', anchor: 'tool-symmetric' },
  'sketch:trim': { page: 'sketching/tools.html', anchor: 'tool-trim' },
  'sketch:extend': { page: 'sketching/tools.html', anchor: 'tool-extend' },
  'sketch:break': { page: 'sketching/tools.html', anchor: 'tool-break' },
  'sketch:split': { page: 'sketching/tools.html', anchor: 'tool-split' },
  'sketch:fillet': { page: 'sketching/tools.html', anchor: 'tool-fillet' },
  'sketch:chamfer': { page: 'sketching/tools.html', anchor: 'tool-chamfer' },
  'sketch:offset': { page: 'sketching/tools.html', anchor: 'tool-offset' },
  'sketch:mirror': { page: 'sketching/tools.html', anchor: 'tool-mirror' },
  'sketch:pattern-linear': { page: 'sketching/tools.html', anchor: 'tool-pattern-linear' },
  'sketch:pattern-circular': { page: 'sketching/tools.html', anchor: 'tool-pattern-circular' },
  'sketch:move': { page: 'sketching/tools.html', anchor: 'tool-move' },
  'sketch:copy': { page: 'sketching/tools.html', anchor: 'tool-copy' },
  'sketch:rotate': { page: 'sketching/tools.html', anchor: 'tool-rotate' },
  'sketch:scale': { page: 'sketching/tools.html', anchor: 'tool-scale' },
  'sketch:project': { page: 'sketching/tools.html', anchor: 'tool-project' },
  'sketch:construction': { page: 'sketching/tools.html', anchor: 'tool-construction' },
  'sketch3d': { page: 'sketching/sketch-3d.html', anchor: 'quick-start' },
  'feature:sketch': { page: 'sketching/start.html', anchor: 'enter-a-sketch' },
  'feature:sketch3d': { page: 'sketching/sketch-3d.html', anchor: 'quick-start' },
  'feature:extrude': { page: 'modelling/solids.html', anchor: 'extrude' },
  'feature:revolve': { page: 'modelling/solids.html', anchor: 'revolve' },
  'feature:sweep': { page: 'modelling/solids.html', anchor: 'sweep' },
  'feature:loft': { page: 'modelling/solids.html', anchor: 'loft' },
  'feature:sphere': { page: 'modelling/solids.html', anchor: 'sphere' },
  'feature:fillet': { page: 'modelling/edges.html', anchor: 'fillet' },
  'feature:chamfer': { page: 'modelling/edges.html', anchor: 'chamfer' },
  'feature:shell': { page: 'modelling/edges.html', anchor: 'shell' },
  'feature:draft': { page: 'modelling/edges.html', anchor: 'draft' },
  'feature:rib': { page: 'modelling/edges.html', anchor: 'rib-and-lip' },
  'feature:lip': { page: 'modelling/edges.html', anchor: 'rib-and-lip' },
  'feature:hole': { page: 'modelling/holes.html', anchor: 'the-hole-editor' },
  'feature:thread': { page: 'modelling/holes.html', anchor: 'the-thread-editor' },
  'feature:helix': { page: 'modelling/reference-geometry.html', anchor: 'helix' },
  'feature:plane': { page: 'modelling/reference-geometry.html', anchor: 'plane' },
  'feature:axis': { page: 'modelling/reference-geometry.html', anchor: 'axis' },
  'feature:lpattern': { page: 'modelling/patterns.html', anchor: 'linear-pattern' },
  'feature:cpattern': { page: 'modelling/patterns.html', anchor: 'circular-pattern' },
  'feature:curvepattern': { page: 'modelling/patterns.html', anchor: 'pattern-on-path' },
  'feature:fillpattern': { page: 'modelling/patterns.html', anchor: 'seeds-what-gets-repeated' },
  'feature:spattern': { page: 'modelling/patterns.html', anchor: 'seeds-what-gets-repeated' },
  'feature:mirror': { page: 'modelling/patterns.html', anchor: 'mirror' },
  'feature:scale': { page: 'modelling/patterns.html', anchor: 'scale' },
  'feature:moveFace': { page: 'modelling/transforms.html', anchor: 'move-rotate-and-copy' },
  'feature:pressPull': { page: 'modelling/transforms.html', anchor: 'press-pull' },
  'feature:moveBody': { page: 'modelling/transforms.html', anchor: 'move-rotate-and-copy' },
  'feature:trimSurface': { page: 'modelling/surfaces.html', anchor: 'trim-knit-thicken' },
  'feature:surfacePlanar': { page: 'modelling/surfaces.html', anchor: 'making-a-sheet' },
  'feature:surfaceRevolve': { page: 'modelling/surfaces.html', anchor: 'making-a-sheet' },
  'feature:surfaceExtrude': { page: 'modelling/surfaces.html', anchor: 'making-a-sheet' },
  'feature:surfaceOffset': { page: 'modelling/surfaces.html', anchor: 'offset-surface' },
  'feature:knit': { page: 'modelling/surfaces.html', anchor: 'trim-knit-thicken' },
  'feature:fill': { page: 'modelling/surfaces.html', anchor: 'fill-and-extend' },
  'feature:extend': { page: 'modelling/surfaces.html', anchor: 'fill-and-extend' },
  'feature:thicken': { page: 'modelling/surfaces.html', anchor: 'trim-knit-thicken' },
  'feature:pipeCut': { page: 'modelling/surfaces.html', anchor: 'pipe-cut' },
  'feature:cutWithSurface': { page: 'modelling/surfaces.html', anchor: 'not-available' },
  'feature:dome': { page: 'modelling/solids.html', anchor: 'dome' },
  'feature:splitLine': { page: 'modelling/solids.html', anchor: 'split-face' },
  'feature:torus': { page: 'modelling/solids.html', anchor: 'torus' },
  'feature:pipe': { page: 'modelling/solids.html', anchor: 'pipe' },
  'feature:coil': { page: 'modelling/solids.html', anchor: 'coil' },
  'feature:boundingSolid': { page: 'modelling/solids.html', anchor: 'bounding-solid' },
  'feature:deleteBody': { page: 'modelling/bodies.html', anchor: 'delete-body' },
  'feature:deleteFace': { page: 'modelling/surfaces.html', anchor: 'trim-knit-thicken' },
  'feature:combine': { page: 'modelling/bodies.html', anchor: 'combine-bodies' },
  'feature:split': { page: 'modelling/cases-and-moulds.html', anchor: 'split-body' },
  'feature:lipJoint': { page: 'modelling/cases-and-moulds.html', anchor: 'lip-joint' },
  'feature:projectCurve': { page: 'modelling/curves.html', anchor: 'project-curve' },
  'feature:editCurve': { page: 'modelling/curves.html', anchor: 'edit-curve' },
  'feature:offsetCurve': { page: 'modelling/curves.html', anchor: 'offset-curve' },
  'feature:compositeCurve': { page: 'modelling/curves.html', anchor: 'composite-curve' },
  'feature:sweepSurface': { page: 'modelling/surfaces.html', anchor: 'sweep-surface' },
  'feature:blendSurface': { page: 'modelling/surfaces.html', anchor: 'blend-surface' },
  'feature:freeform': { page: 'modelling/curves.html', anchor: 'freeform' },
  'feature:knurlBand': { page: 'library/wizards.html', anchor: 'knurl' },
  'feature:importStep': { page: 'files/import.html', anchor: 'step' },
  'feature:repairPart': { page: 'files/import.html', anchor: 'the-import-report-and-repair' },
  'feature:insertPart': { page: 'assemblies/assemblies.html', anchor: 'insert-a-part' },
  'feature:mate': { page: 'assemblies/assemblies.html', anchor: 'mates' },
  'feature:frame': { page: 'modelling/frames.html', anchor: 'build-a-frame' },
  'feature:sheetRules': { page: 'modelling/sheet-metal.html', anchor: 'the-rule' },
  'feature:baseFlange': { page: 'modelling/sheet-metal.html', anchor: 'base-flange' },
  'feature:edgeFlange': { page: 'modelling/sheet-metal.html', anchor: 'edge-flange' },
  'feature:hem': { page: 'modelling/sheet-metal.html', anchor: 'hem-and-fold' },
  'feature:fold': { page: 'modelling/sheet-metal.html', anchor: 'hem-and-fold' },
  'feature:contourFlange': { page: 'modelling/sheet-metal.html', anchor: 'contour-flange' },
  'feature:unfold': { page: 'modelling/sheet-metal.html', anchor: 'unfold-and-refold' },
  'feature:refold': { page: 'modelling/sheet-metal.html', anchor: 'unfold-and-refold' },
  'feature:sheetConvert': { page: 'modelling/sheet-metal.html', anchor: 'convert-to-sheet' },
  'feature:sheetCut': { page: 'modelling/sheet-metal.html', anchor: 'cut' },
  'feature:sheetCorner': { page: 'modelling/sheet-metal.html', anchor: 'corner' },
  'wizard:gear': { page: 'library/wizards.html', anchor: 'gears' },
  'wizard:propeller': { page: 'library/wizards.html', anchor: 'airfoil-propeller' },
  'wizard:marine': { page: 'library/wizards.html', anchor: 'marine-propeller' },
  'wizard:impeller': { page: 'library/wizards.html', anchor: 'turbo-impellers' },
  'wizard:bearing': { page: 'library/wizards.html', anchor: 'bearings' },
  'wizard:screw': { page: 'library/wizards.html', anchor: 'screws' },
  'wizard:washer': { page: 'library/wizards.html', anchor: 'washers' },
  'wizard:nut': { page: 'library/wizards.html', anchor: 'nuts' },
  'wizard:standoff': { page: 'library/wizards.html', anchor: 'standoffs' },
  'wizard:insert': { page: 'library/wizards.html', anchor: 'heat-set-inserts' },
  'wizard:spring': { page: 'library/wizards.html', anchor: 'springs' },
  'wizard:case': { page: 'library/wizards.html', anchor: 'make-a-case' },
  'wizard:fasten': { page: 'library/wizards.html', anchor: 'adding-a-bolt-to-a-hole' },
  'wizard:knurl': { page: 'library/wizards.html', anchor: 'knurl' },
  'wizard:cornerHoles': { page: 'modelling/holes.html', anchor: 'corner-holes' },
  'wizard:mesh': { page: 'files/import.html', anchor: 'mesh-files-stl-obj-glb-and-3mf-a-model-to-sketch-on' },
  'wizard:meshSolid': { page: 'files/import.html', anchor: 'convert-a-mesh-to-a-solid-preview' },
  'wizard:material': { page: 'assemblies/appearance.html', anchor: 'the-material' },
};

/** The guide's root on this site, with a trailing slash. The published site serves the guide at `/docs/cad/` beside the app, so on a real web origin the
 *  help stays on the site you are using; a local server, a file or the desktop app (`tauri:` pages) has no guide, so it points at the public one. */
export const PUBLIC_DOCS = 'https://civilkit.io/docs/cad/';
export function docsBase(loc: Pick<Location, 'protocol' | 'hostname' | 'origin'> = location): string {
  const web = /^https?:$/.test(loc.protocol);
  const local = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0|tauri\.localhost)$/.test(loc.hostname) || loc.hostname.endsWith('.local');
  return web && !local ? loc.origin + '/docs/cad/' : PUBLIC_DOCS;
}

/** The full guide address for a topic, or null for an unknown one. Always absolute: the desktop app opens only http(s) links outside itself. */
export function guideUrl(topic: string, base: string = docsBase()): string | null {
  const e = HELP[topic];
  if (!e) return null;
  return base + e.page + (e.anchor ? '#' + e.anchor : '');
}

/** The catalogue key part of a topic: the colon becomes a dot (`sketch:line` -> `sketch.line`). */
export const topicKey = (topic: string): string => topic.replace(':', '.');

export interface HelpCard { topic: string; name: string; summary: string; url: string }

/** What the help card shows for a topic: the name, the one-sentence summary and the guide address. An unknown topic falls back to the guide's front page. */
export function helpCard(topic: string, base?: string): HelpCard {
  const known = topic in HELP;
  const id = known ? topic : 'guide';
  const e = HELP[id], id2 = topicKey(id);
  return { topic: id, name: t(`help.${id2}.name`), summary: e.summary ?? t(`help.${id2}.sum`), url: guideUrl(id, base) as string };
}

/** What the person is working with, for F1 and the global '?': a wizard, else the open feature editor, else the sketch (and its tool), else the guide. */
export interface HelpContext { wizard?: string | null; feature?: string | null; sketching?: boolean; tool?: string | null; sketch3d?: boolean }
export function currentTopic(c: HelpContext): string {
  const pick = (topic: string): string | null => (topic in HELP ? topic : null);
  return (c.sketch3d ? 'sketch3d' : null)
    ?? (c.wizard ? pick('wizard:' + c.wizard) : null)
    ?? (c.feature ? pick('feature:' + c.feature) : null)
    ?? (c.sketching ? (c.tool ? pick('sketch:' + c.tool) : null) ?? 'sketch' : null)
    ?? 'guide';
}
