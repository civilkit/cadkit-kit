// Helpers shared by the UX scripts that need a part open in the app (mobile.mjs, sketch.mjs).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Why no part is open, in one line: the app's error notice and the page's first console errors (the kernel worker failing to load shows here),
 *  or null when a part is open. */
export async function noPartReason(page) {
  const open = await page.eval(`!!window.__cad?.controller.document()`).catch(() => false);
  if (open) return null;
  const notice = await page.eval(`[...document.querySelectorAll('.toast, [role=alert]')].map((e) => e.textContent.trim()).filter(Boolean).join(' | ')`).catch(() => '');
  const title = await page.eval(`document.querySelector('.doc-name, .doc-switch')?.textContent.trim() ?? ''`).catch(() => '');
  const logs = [...new Set(page.logs)].slice(0, 3).map((l) => l.split('\n').slice(0, 2).join(' ').slice(0, 200));
  return `no part open (title "${title}"${notice ? `, notice "${notice}"` : ''}${logs.length ? `, console: ${logs.join(' / ')}` : ''})`;
}

/** Wait for the status bar's ready mark (nothing rebuilding). */
export async function idle(page, ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await page.eval(`!!document.querySelector('.status .ready')`).catch(() => false)) return true; await sleep(200); }
  return false;
}

/** Start the app with `doc` restored from the autosave slot (or a fresh empty part when `doc` is null) and the given localStorage items.
 *  Throws with noPartReason() when no part opens, so a script stops with the cause instead of failing every later check. */
export async function openDoc(page, doc, items = {}) {
  const all = { 'cad.theme': '"light"', ...items, ...(doc ? { 'cad.autosave.v1': JSON.stringify({ name: doc.name ?? 'Part', doc, savedAt: Date.now() }) } : {}) };
  await page.eval(`localStorage.clear(); const it = ${JSON.stringify(all)}; for (const k in it) localStorage.setItem(k, it[k]); 0`);
  page.logs.length = 0;
  await page.send('Page.reload'); await sleep(800);
  for (let i = 0; i < 100 && !(await page.eval(`!!document.querySelector('.status')`).catch(() => false)); i++) await sleep(150);
  if (doc) {
    for (let i = 0; i < 40; i++) {
      const hit = await page.eval(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Restore' && x.getBoundingClientRect().width > 0); if (b) b.click(); return !!b; })()`).catch(() => false);
      if (hit) break; await sleep(150);
    }
  }
  await idle(page);
  for (let i = 0; i < 50 && !(await page.eval(`!!window.__cad?.controller.document()`).catch(() => false)); i++) await sleep(200);
  const why = await noPartReason(page);
  if (why) throw new Error(why);
}
