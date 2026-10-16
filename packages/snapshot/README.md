# @kit/snapshot

Deterministic, GPU-free renderer: kernel body to PNG (named views, hidden-line drawings, hatched section views, markers,
dimensions, A|B sheet, pixel diff). Pure TypeScript, runs in Node and the browser. Full documentation: `docs/snapshot.md`.

```ts
import { renderSnapshot, snapshotOf, diffImages } from '@kit/snapshot';

const { png, meta } = await snapshotOf(session, { view: 'iso', size: 768 });
const sheet = await snapshotOf(session, { sheet: 'drawing-third-angle' });
const cut = await snapshotOf(session, { view: 'iso', section: { axis: 'z', at: 5 }, sheet: 'section' });
const d = await diffImages(before.png, after.png); // { changedPct, diffPng, bbox }
```

Stable exports: `renderSnapshot(input, opts)` and `snapshotOf(session, opts)`.
