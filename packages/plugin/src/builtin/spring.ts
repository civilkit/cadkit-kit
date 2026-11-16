// Built-in plugin 2: springs (P1's second wizard). One generator over the three kinds the Spring wizard has; the parameters that apply
// to one kind only are hidden for the others (visibleIf), and size parameters left out take the kind's own defaults, as the wizard does.
import type { PluginManifest } from '../manifest';
import type { GenerateFn } from '../registry';
import type { Values } from '../params';

export const SPRING_PLUGIN_ID = 'civilkit.springs';
const KIND_DEFAULTS = { compression: { outer: 20, wire: 2, coils: 8 }, extension: { outer: 12, wire: 1, coils: 15 }, torsion: { outer: 14, wire: 1.2, coils: 5.25 } } as const;
const AXES: Record<string, [number, number, number]> = { pz: [0, 0, 1], nz: [0, 0, -1], px: [1, 0, 0], nx: [-1, 0, 0], py: [0, 1, 0], ny: [0, -1, 0] };

export const springManifest: PluginManifest = {
  id: SPRING_PLUGIN_ID,
  name: 'Springs',
  version: '0.1.0',
  engine: '>=0.7.0',
  license: 'MIT',
  description: 'Compression, extension and torsion springs as swept wire.',
  contributes: {
    generators: [{
      id: 'spring',
      title: 'Spring',
      category: 'Mechanisms',
      description: 'A helical spring: compression (free length, plain / closed / ground ends, cone and progressive pitch), extension (machine hooks) or torsion (two legs).',
      params: [
        { name: 'kind', type: 'enum', title: 'Kind', options: [{ value: 'compression' }, { value: 'extension' }, { value: 'torsion' }], default: 'compression', group: 'Spring' },
        { name: 'outer', type: 'number', title: 'Outside diameter', description: 'left out: 20 (compression), 12 (extension) or 14 (torsion)', unit: 'mm', optional: true, min: 0.1, max: 2000, group: 'Spring' },
        { name: 'wire', type: 'number', title: 'Wire diameter', description: 'left out: 2, 1 or 1.2 by kind', unit: 'mm', optional: true, min: 0.05, max: 200, group: 'Spring' },
        { name: 'coils', type: 'number', title: 'Turns', description: 'left out: 8, 15 or 5.25 by kind; fractions are fine', optional: true, min: 0.25, max: 500, group: 'Spring' },
        { name: 'length', type: 'number', title: 'Free length', description: 'end to end, wire included', unit: 'mm', default: 40, min: 0.1, max: 5000, visibleIf: { param: 'kind', equals: 'compression' }, group: 'Spring' },
        { name: 'hand', type: 'enum', title: 'Hand', options: [{ value: 'right' }, { value: 'left' }], default: 'right', group: 'Spring' },
        { name: 'ends', type: 'enum', title: 'Ends', options: [{ value: 'plain' }, { value: 'closed' }, { value: 'ground' }], default: 'plain', visibleIf: { param: 'kind', equals: 'compression' }, group: 'Compression' },
        { name: 'closedTurns', type: 'number', title: 'Closed turns', description: 'touching turns at each end, counted in Turns', default: 1, min: 0.25, max: 50, visibleIf: { param: 'ends', in: ['closed', 'ground'] }, group: 'Compression' },
        { name: 'topOuter', type: 'number', title: 'Far-end outside diameter', description: 'a different value makes a cone', unit: 'mm', optional: true, min: 0.1, max: 2000, visibleIf: { param: 'kind', equals: 'compression' }, group: 'Compression' },
        { name: 'progression', type: 'number', title: 'Pitch ratio', description: 'pitch at the far end divided by the pitch at the first end; 1 is even', default: 1, min: 0.05, max: 20, visibleIf: { param: 'kind', equals: 'compression' }, group: 'Compression' },
        { name: 'leg1', type: 'number', title: 'Leg 1', unit: 'mm', default: 21, min: 0.1, max: 1000, visibleIf: { param: 'kind', equals: 'torsion' }, group: 'Torsion' },
        { name: 'leg2', type: 'number', title: 'Leg 2', unit: 'mm', default: 21, min: 0.1, max: 1000, visibleIf: { param: 'kind', equals: 'torsion' }, group: 'Torsion' },
        { name: 'axis', type: 'enum', title: 'Extends along', options: ['pz', 'nz', 'px', 'nx', 'py', 'ny'].map((value) => ({ value })), default: 'pz', group: 'Placement' },
        { name: 'x', type: 'number', title: 'Start X', description: 'centre of the first end', unit: 'mm', default: 0, group: 'Placement' },
        { name: 'y', type: 'number', title: 'Start Y', unit: 'mm', default: 0, group: 'Placement' },
        { name: 'z', type: 'number', title: 'Start Z', unit: 'mm', default: 0, group: 'Placement' },
        { name: 'name', type: 'string', title: 'Name', description: 'tree folder and body name; made unique ("Spring 2") when taken', default: 'Spring', maxLength: 60, group: 'Placement' },
      ],
    }],
  },
};

const q = (s: unknown): string => JSON.stringify(String(s));
export const generateSpring: GenerateFn = (v: Values, ctx) => {
  const kind = String(v.kind) as keyof typeof KIND_DEFAULTS;
  const d = KIND_DEFAULTS[kind];
  const outer = v.outer ?? d.outer, wire = v.wire ?? d.wire, coils = v.coils ?? d.coils;
  const name = ctx.uniqueName(String(v.name).trim() || 'Spring');
  const common = `outer: ${outer}, wire: ${wire}, coils: ${coils}, hand: ${q(v.hand)}, origin: [${v.x}, ${v.y}, ${v.z}], axis: [${AXES[String(v.axis)].join(', ')}], name: ${q(name)}`;
  if (kind === 'extension') return `extensionSpring({ ${common} });\n`;
  if (kind === 'torsion') return `torsionSpring({ ${common}, leg1: ${v.leg1}, leg2: ${v.leg2} });\n`;
  const extra = [
    v.ends !== 'plain' ? `closedTurns: ${v.closedTurns}` : '',
    v.topOuter !== undefined && v.topOuter !== outer ? `topOuter: ${v.topOuter}` : '',
    v.progression !== 1 ? `progression: ${v.progression}` : '',
  ].filter(Boolean);
  return `spring({ ${common}, length: ${v.length}, ends: ${q(v.ends)}${extra.length ? ', ' + extra.join(', ') : ''} });\n`;
};
