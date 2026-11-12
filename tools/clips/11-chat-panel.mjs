// The Chat panel: ask for a part in words, watch the answer stream and the part build, then undo it in one step.
// Needs the local service running and a pairing code (never committed): CK_PAIR_CODE=<code from `ck-mcp.mjs --pair`>.
// The wait for the model is real; stretches where nothing arrives are cut out of the clip (keeping about 1 s of each), so the
// typing, the streamed text, the tool lines and the result play at real speed.
import { writeFileSync } from 'node:fs';
const PRESET = { ribbon: 'off', leftPanel: 'docked', leftTabs: true, leftCollapsed: false, rightPanel: 'off', toolRail: true, sketchPalette: false, toolLabels: 'icons-and-text', selectionBar: true, commandBar: true, drawerOpen: false, handles: true, opacity: 0.62, blur: 14, lineWidth: 3 };
const PROMPT = 'Draw a 40x40x5 mm plate with R8 corner fillets and four M5 countersunk holes 8 mm in from the edges: 5.5 mm through hole, 11.2 mm x 90 degree countersink.';
const IDLE = 1.0;   // seconds of waiting kept before a stretch with no news is cut
export default {
  id: 'chat-panel',
  async run(rec, ctx) {
    const code = process.env.CK_PAIR_CODE;
    if (!code) throw new Error('CK_PAIR_CODE is not set');
    const shots = process.env.CLIP_SHOTS;
    const shot = async (n) => { if (shots) writeFileSync(`${shots}/${n}.png`, await ctx.page.screenshot()); };
    await ctx.openApp();
    await ctx.page.eval(`localStorage.setItem('cad.workspace', ${JSON.stringify(JSON.stringify(PRESET))})`);
    await ctx.openApp();
    // off camera: pair, tick the edit box, go back to the first tab
    await ctx.page.eval(`document.querySelector('[data-testid="open-chat"]').click()`);
    await rec.waitFor(`!!document.querySelector('[data-testid="chat-code"]')`, 'the set-up card');
    await ctx.page.eval(`(() => { const i = document.querySelector('[data-testid="chat-code"]'); i.focus(); })()`);
    await ctx.page.send('Input.insertText', { text: code });
    await new Promise((r) => setTimeout(r, 300));
    await ctx.page.eval(`document.querySelector('[data-testid="chat-link"]').click()`);
    await rec.waitFor(`!!document.querySelector('[data-testid="chat-allow-edit"]')`, 'the link');
    await ctx.page.eval(`document.querySelector('[data-testid="chat-allow-edit"]').click()`);
    await rec.waitFor(`document.querySelector('[data-testid="chat-allow-edit"]').checked`, 'the edit box');
    await ctx.page.eval(`document.querySelector('[data-testid="left-tab-Outliner"]').click()`);
    // a new part
    await ctx.page.eval(`document.querySelector('.topbar [data-action="new-tab"]').click()`);
    await new Promise((r) => setTimeout(r, 1500));
    // the empty-viewport hint card is dismissed (its X), so the viewport is clear while the part builds
    await ctx.page.eval(`(() => { const t = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && e.textContent === 'Start here'); const b = t?.parentElement?.parentElement?.querySelector('button[aria-label="Close"]') ?? t?.parentElement?.querySelector('button[aria-label="Close"]'); b?.click(); })()`);
    await new Promise((r) => setTimeout(r, 500));
    await shot('0-new');
    await rec.begin();
    await rec.wait(600);
    await rec.click(`document.querySelector('[data-testid="open-chat"]')`);
    await rec.waitFor(`!!document.querySelector('[data-testid="chat-input"]')`, 'the chat');
    await rec.wait(800);
    await rec.click(`document.querySelector('[data-testid="chat-input"]')`);
    for (let i = 0; i < PROMPT.length; i += 6) { await ctx.page.send('Input.insertText', { text: PROMPT.slice(i, i + 6) }); await rec.paint(); await new Promise((r) => setTimeout(r, 25)); }   // six characters a step: a faster hand than rec.type
    await rec.wait(500);
    await shot('1-typed');
    await rec.click(`document.querySelector('[data-testid="chat-send"]')`);
    // follow the answer; cut the stretches where nothing changes
    const sig = `(() => { const l = document.querySelector('[data-testid="chat-log"]'); return l ? l.textContent.length + ':' + l.children.length + ':' + (document.querySelectorAll('.tree .row[data-id]').length) : ''; })()`;
    let last = '', lastChange = Date.now() / 1000, cutFrom = null, n = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 240000) {
      const busy = await ctx.page.eval(`!!document.querySelector('[data-testid="chat-working"]') || !!document.querySelector('[data-testid="chat-stop"]')`);
      const s = await ctx.page.eval(sig); const nowS = Date.now() / 1000;
      if (s !== last) { if (cutFrom !== null) { rec.skips.push([cutFrom, nowS - 0.3]); cutFrom = null; } last = s; lastChange = nowS; await rec.paint(); }
      else if (nowS - lastChange > IDLE && cutFrom === null && busy) cutFrom = nowS;
      if (!busy && nowS - lastChange > 0.8) break;
      await new Promise((r) => setTimeout(r, 150));
      if (++n % 20 === 0) await shot('2-wait-' + (n / 20));
    }
    if (cutFrom !== null) rec.skips.push([cutFrom, Date.now() / 1000 - 0.3]);
    await rec.wait(600);
    if (process.env.CLIP_REHEARSE) { writeFileSync(`${shots}/reply.txt`, await ctx.page.eval(`document.querySelector('[data-testid="chat-log"]').innerText + '\\n' + document.querySelector('.status').textContent`)); await shot('3-done'); return { rehearsal: true }; }
    await shot('3-done');
    rec.mark('poster');
    await rec.wait(1800);
    // one undo step takes it all back
    if (process.env.CLIP_UNDO !== '0') {
      await rec.click(`document.querySelector('button[aria-label="Undo"]')`);
      await rec.waitFor(`document.querySelectorAll('.tree .row[data-id]').length === 0 || /Features 0/.test(document.querySelector('.status')?.textContent ?? '')`, 'the undo');
      await rec.wait(1300);
      await shot('4-undone');
    }
    return rec.finish('chat-panel', ctx.outDir, ctx.posterDir);
  },
};
