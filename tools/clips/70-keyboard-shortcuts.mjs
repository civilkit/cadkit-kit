// Rebind the keyboard shortcuts (0.8.9): the shortcuts sheet (?) is an editor. Pick the SolidWorks-style set and back to the CadKit one, click the key of Isometric view and press a key
// already used (a prompt names the command; Cancel), click again and press a free key, remove the key of Front view with its x, reset Isometric view's own key, rebind it again, close the
// sheet and use the new key in the viewport. Load-tolerant (see clipkit.mjs).
import { openDoc, kit } from './clipkit.mjs';
import { newDoc } from '../doc_shots_defs.mjs';

const SK = { type: 'sketch', id: 'F1', name: 'Block outline', plane: { kind: 'std', id: 'front' }, points: [{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 40, y: 0 }, { id: 'p3', x: 40, y: 20 }, { id: 'p4', x: 0, y: 20 }],
  entities: [['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']].map(([id, a, b]) => ({ type: 'line', id, p1: a, p2: b })), constraints: [] };
const FEATURES = [SK, { type: 'extrude', id: 'F2', name: 'Block', op: 'add', sketch: 'F1', end: 'blind', depth: 10 }];
export const doc = () => newDoc('Block', [...FEATURES]);
const TID = (id) => `document.querySelector('[data-testid="${id}"]')`;
const ROW = (id) => `document.querySelector('[data-shortcut="${id}"]')`;

export default {
  id: 'keyboard-shortcuts',
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, doc(), { workspace: undefined });
    await page.eval(`document.querySelector('.start-close')?.click(); 0`);
    const k = kit(rec, ctx);
    const hold = async (ms) => { for (let t = 0; t < ms; t += 500) await rec.wait(500); };
    await page.eval(`document.querySelector('button[aria-label="Fit"]')?.click(); 0`);
    await k.settle();
    await rec.begin();
    rec.x = 1000; rec.y = 620;
    await k.caption('Press ? to open the keyboard shortcuts', 1);
    await hold(1200);
    await k.key('?', { shift: true });
    try { await k.waitUi(`!!${TID('shortcut-sheet')}`, 'the shortcut sheet', 20000); } catch (e) { await k.snap('70x-sheet'); throw e; }
    await k.settle(600);
    await k.snap('70a-sheet');
    rec.mark('poster');
    await hold(2500);
    await k.caption('Pick a set: SolidWorks-style keys', 2);
    await k.choose(TID('keymap-preset'), /SolidWorks/i, 2200);
    await k.snap('70b-solidworks');
    await k.choose(TID('keymap-preset'), /CadKit|Default/i, 1200);
    // the sheet's search box narrows the list
    await k.caption('Click a key, then press the new one', 3);
    await k.step(() => page.eval(`(() => { const i = document.querySelector('[data-testid=shortcut-sheet] input[type=search]'); i.focus(); })()`), 200, false);
    await k.step(() => page.send('Input.insertText', { text: 'view' }), 600);
    await k.settle(500);
    await k.step(() => page.eval(`${ROW('view-iso')}.scrollIntoView({ block: 'center', behavior: 'instant' }); 0`), 500, false);
    await k.clickEl(TID('rebind-view-iso'), 'left', 900);
    await k.snap('70c-recording');
    await k.key('1');
    await k.waitUi(`!!${TID('keymap-clash')}`, 'the conflict prompt', 20000);
    await k.snap('70d-clash');
    await k.caption('A key already in use asks before it is taken', 4);
    await hold(3500);
    await k.clickEl(`[...document.querySelectorAll('[data-testid=keymap-clash] button')].find((b) => /cancel/i.test(b.textContent))`, 'left', 900);
    await k.caption('A free key: I for Isometric view', 5);
    await k.clickEl(TID('rebind-view-iso'), 'left', 700);
    await k.key('i');
    await k.settle(500);
    await k.snap('70e-bound');
    await hold(2800);
    // remove one key, then reset the changed one
    await k.caption('x removes a key, the circle arrow resets one', 6);
    await k.step(() => page.eval(`${ROW('view-front')}.scrollIntoView({ block: 'center', behavior: 'instant' }); 0`), 500, false);
    await k.clickEl(`${ROW('view-front')}.querySelector('.kbd-x')`, 'left', 1600);
    await k.snap('70f-unbound');
    await k.step(() => page.eval(`${ROW('view-iso')}.scrollIntoView({ block: 'center', behavior: 'instant' }); 0`), 500, false);
    await k.clickEl(TID('reset-view-iso'), 'left', 1500);
    await k.snap('70g-reset');
    await k.caption('Rebind it once more, then close the sheet', 7);
    await k.clickEl(TID('rebind-view-iso'), 'left', 600);
    await k.key('i');
    await k.settle(500);
    await hold(1500);
    await k.key('Escape');
    await k.waitUi(`!${TID('shortcut-sheet')}`, 'the sheet to close', 10000);
    await k.settle(500);
    await k.caption('The new key works in the viewport: I turns the part to Isometric', 8);
    await k.key('2');   // Front view is unbound now; use Top (1) to set a known view first
    await k.key('1');
    await hold(1800);
    await k.key('i');
    await k.settle(900);
    await k.snap('70h-iso');
    await hold(3500);
    if (process.env.CLIP_DRY) return { id: 'keyboard-shortcuts', dry: true };
    return rec.finish('keyboard-shortcuts', ctx.outDir, ctx.posterDir);
  },
};
