// Writes apps/cad/public/samples/spur-gear.ckpart, gear-pair.ckpart and herringbone-pair.ckpart:  npx vite-node apps/cad/scripts/genGearSamples.ts
import { writeFileSync } from 'node:fs';
import { HERRINGBONE_PAIR_SAMPLE, PAIR_SAMPLE, SPUR_SAMPLE, samplePart } from '../src/gearSamples';

const out = 'apps/cad/public/samples/';
writeFileSync(out + 'spur-gear.ckpart', JSON.stringify(samplePart('Spur gear', SPUR_SAMPLE)));
writeFileSync(out + 'gear-pair.ckpart', JSON.stringify(samplePart('Gear pair', PAIR_SAMPLE)));
writeFileSync(out + 'herringbone-pair.ckpart', JSON.stringify(samplePart('Herringbone pair', HERRINGBONE_PAIR_SAMPLE)));
