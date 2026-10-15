import { readFileSync } from 'node:fs';
import { it } from 'vitest';
import { Session } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
import { importFcstd } from './import';
it('dump', { skip: !process.env.F }, async () => {
  const imp = await importFcstd(new Uint8Array(readFileSync(process.env.F!)), 'x');
  const want = (process.env.IDS ?? '').split(',');
  const fs = imp.part.features.filter((f) => want.includes(f.id as string));
  const s = await Session.open({ ...imp.part, features: fs } as unknown as PartDoc);
  const f = await s.facts(); const r = await s.regenReport();
  console.log('RESULT', f.volume, JSON.stringify(f.box), JSON.stringify(r.errors).slice(0, 300));
  await s.close();
});
