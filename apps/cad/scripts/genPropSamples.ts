// Writes one .ckpart per propeller preset (and the default) into a directory:  npx vite-node apps/cad/scripts/genPropSamples.ts -- /path/to/dir
// With --marine it writes only the marine sample (marine-propeller.ckpart: 3 blades, mild rake and progressive pitch), e.g. into the shipped samples:
//   npx vite-node apps/cad/scripts/genPropSamples.ts -- --marine apps/cad/public/samples
import { mkdirSync, writeFileSync } from 'node:fs';
import { DEFAULT_PROP, PROP_PRESETS, propDocument } from '../src/propData';
import { MARINE_SAMPLE, marineDocument } from '../src/marineData';

const args = process.argv.slice(2).filter((a) => a !== '--');
const marineOnly = args.includes('--marine');
const dir = (args.filter((a) => a !== '--marine')[0] ?? '.') + '/';
mkdirSync(dir, { recursive: true });

writeFileSync(dir + 'marine-propeller.ckpart', JSON.stringify(marineDocument(MARINE_SAMPLE, 'Marine propeller')));
if (marineOnly) process.exit(0);
writeFileSync(dir + 'prop-default.ckpart', JSON.stringify(propDocument(DEFAULT_PROP, 'Propeller')));
for (const [name, preset] of Object.entries(PROP_PRESETS)) writeFileSync(dir + `prop-${name}.ckpart`, JSON.stringify(propDocument({ ...DEFAULT_PROP, ...preset }, `Propeller ${name}`)));
