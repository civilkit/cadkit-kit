// Built-in plugin 1: the Case generator (P0). The same enclosure as the Case wizard and the Script tab's caseBox(): two shelled cups with
// a tongue on one rim and a groove in the other. The parameter list below is what the wizard hard-codes in CaseWizard.tsx; here it is data,
// so the generated form and the agent tool come from it. Parameters left out take caseBox()'s own defaults (lid a quarter of the height, ...).
import type { PluginManifest } from '../manifest';
import type { GenerateFn } from '../registry';
import type { Values } from '../params';

export const CASE_PLUGIN_ID = 'civilkit.enclosures';

export const caseManifest: PluginManifest = {
  id: CASE_PLUGIN_ID,
  name: 'Enclosures',
  version: '0.1.0',
  engine: '>=0.7.0',
  license: 'MIT',
  description: 'Parametric enclosures.',
  contributes: {
    generators: [{
      id: 'case',
      title: 'Case',
      category: 'Enclosures',
      description: 'A closed hollow box split into a base and a lid, with a tongue on one rim and a groove in the other.',
      params: [
        { name: 'width', type: 'number', title: 'Width', unit: 'mm', default: 80, min: 1, max: 5000, group: 'Size' },
        { name: 'depth', type: 'number', title: 'Depth', unit: 'mm', default: 50, min: 1, max: 5000, group: 'Size' },
        { name: 'height', type: 'number', title: 'Height', description: 'outside height, lid included', unit: 'mm', default: 30, min: 1, max: 5000, group: 'Size' },
        { name: 'wall', type: 'number', title: 'Wall', unit: 'mm', default: 2, min: 0.4, max: 50, group: 'Size' },
        { name: 'radius', type: 'number', title: 'Corner radius', description: '0 for sharp corners; more than 0 it must exceed the wall', unit: 'mm', default: 0, min: 0, max: 2500, group: 'Edges' },
        { name: 'topRadius', type: 'number', title: 'Top round', description: 'round on the outer edges of the lid top and the base bottom; 0 for none', unit: 'mm', default: 0, min: 0, max: 100, group: 'Edges' },
        { name: 'lidHeight', type: 'number', title: 'Lid height', unit: 'mm', optional: true, min: 0.1, max: 5000, group: 'Lid and joint' },
        { name: 'tongueOn', type: 'enum', title: 'Tongue on', options: [{ value: 'lid' }, { value: 'base' }], default: 'lid', group: 'Lid and joint' },
        { name: 'tongueHeight', type: 'number', title: 'Tongue height', unit: 'mm', optional: true, min: 0.05, max: 100, group: 'Lid and joint' },
        { name: 'tongueWidth', type: 'number', title: 'Tongue width', unit: 'mm', optional: true, min: 0.05, max: 100, group: 'Lid and joint' },
        { name: 'clearance', type: 'number', title: 'Clearance', description: 'gap between tongue and groove', unit: 'mm', default: 0.2, min: 0, max: 1, group: 'Lid and joint' },
        { name: 'baseName', type: 'string', title: 'Base name', default: 'Base', maxLength: 60, group: 'Names' },
        { name: 'lidName', type: 'string', title: 'Lid name', default: 'Lid', maxLength: 60, group: 'Names' },
        { name: 'axis', type: 'enum', title: 'Rises along', description: "'y' is the app's up axis (the floor on the Top plane); 'z' lies on the Front plane", options: [{ value: 'y' }, { value: 'z' }], default: 'y', group: 'Placement' },
        { name: 'x', type: 'number', title: 'Centre X', description: 'centre of the bottom face', unit: 'mm', default: 0, group: 'Placement' },
        { name: 'y', type: 'number', title: 'Centre Y', unit: 'mm', default: 0, group: 'Placement' },
        { name: 'z', type: 'number', title: 'Centre Z', unit: 'mm', default: 0, group: 'Placement' },
      ],
    }],
  },
};

const q = (s: unknown): string => JSON.stringify(String(s));
/** The caseBox() call for the checked values. */
export const generateCase: GenerateFn = (v: Values) => {
  const opt = (k: string): string => (v[k] === undefined ? '' : `${k}: ${v[k]}, `);
  return `caseBox({ width: ${v.width}, depth: ${v.depth}, height: ${v.height}, wall: ${v.wall}, radius: ${v.radius}, topRadius: ${v.topRadius}, ${opt('lidHeight')}${opt('tongueHeight')}${opt('tongueWidth')}clearance: ${v.clearance}, tongueOn: ${q(v.tongueOn)}, names: [${q(String(v.baseName).trim())}, ${q(String(v.lidName).trim())}], axis: ${q(v.axis)}, origin: [${v.x}, ${v.y}, ${v.z}] });\n`;
};
