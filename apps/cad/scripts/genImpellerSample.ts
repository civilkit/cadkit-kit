// Writes apps/cad/public/samples/turbo-impeller.ckpart:  npx vite-node apps/cad/scripts/genImpellerSample.ts
import { writeFileSync } from 'node:fs';
import { DEFAULT_IMPELLER, impellerDocument } from '../src/impellerData';

writeFileSync('apps/cad/public/samples/turbo-impeller.ckpart', JSON.stringify(impellerDocument(DEFAULT_IMPELLER, 'Turbo impeller')));
console.log('wrote apps/cad/public/samples/turbo-impeller.ckpart');
