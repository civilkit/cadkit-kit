// Writes one .ckpart per propeller preset (and the default) into a directory:  npx vite-node apps/cad/scripts/genPropSamples.ts -- /path/to/dir
import { mkdirSync, writeFileSync } from 'node:fs';
import { DEFAULT_PROP, PROP_PRESETS, propDocument } from '../src/propData';

const dir = (process.argv.slice(2).filter((a) => a !== '--')[0] ?? '.') + '/';
mkdirSync(dir, { recursive: true });
writeFileSync(dir + 'prop-default.ckpart', JSON.stringify(propDocument(DEFAULT_PROP, 'Propeller')));
for (const [name, preset] of Object.entries(PROP_PRESETS)) writeFileSync(dir + `prop-${name}.ckpart`, JSON.stringify(propDocument({ ...DEFAULT_PROP, ...preset }, `Propeller ${name}`)));
