// A fold across a window in the sheet: the bend runs through the opening and the part builds (it was refused before).
const SCRIPT = `part('Bracket')
  .sheetRules({ name: 'Steel 2', thickness: 2 })
  .sketch('front', (s) => s.rect(100, 60).rect(30, 24))
  .baseFlange()
  .fold({ points: [[0, -30, 2], [0, 30, 2]], angle: 90 });`;
export default {
  id: 'fold-across-window',
  async run(rec, ctx) {
    await ctx.openApp();
    await rec.begin();
    await rec.wait(700);
    await rec.click(`document.querySelector('button.pt[aria-label="Script"]') ?? [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Script')`);
    await rec.waitFor(`!!document.querySelector('.script-ta')`, 'the script box');
    await rec.wait(600);
    await rec.click(`document.querySelector('.script-ta')`);
    await rec.page.eval(`(() => { const t = document.querySelector('.script-ta'); t.focus(); t.select(); })()`);
    await rec.page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    await rec.page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    await rec.page.send('Input.insertText', { text: SCRIPT });
    await rec.wait(2200);
    await rec.click(`document.querySelector('.script-panel .btn.primary')`);
    await rec.skip(() => rec.waitFor(`document.querySelectorAll('canvas').length > 0 && /bodies|solid|Ready/i.test(document.body.innerText)`, 'the result'));
    await rec.wait(2500);
    rec.mark('poster');
    await rec.wait(2500);
    return rec.finish('fold-across-window', ctx.outDir, ctx.posterDir);
  },
};
