// Automatic UX metrics: an in-page scan of the live DOM (via CDP Runtime.evaluate) plus a real Tab walk.
// collectMetrics(page) -> object (written as <scenario>.json); summarise(metrics) -> rows for report.md.

export const THRESHOLDS = { floatingPanels: 4, radii: 6, shadows: 4, fontSizes: 8, fontFamilies: 3, tinyPx: 24, smallPx: 32, contrastText: 4.5, contrastIcon: 3, minFontPx: 11 };

const SCAN = `(T) => {
  const vw = innerWidth, vh = innerHeight;
  const cap = (a, n = 15) => a.slice(0, n);
  const cs = (e) => getComputedStyle(e);
  const isVisible = (e) => { const r = e.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; for (let n = e; n && n.nodeType === 1; n = n.parentElement) { const s = cs(n); if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false; } return true; };
  const sel = (e) => { let s = e.tagName.toLowerCase(); if (e.id) s += '#' + e.id; const c = (typeof e.className === 'string' ? e.className : '').trim().split(/\\s+/).filter(Boolean).slice(0, 3); if (c.length) s += '.' + c.join('.'); return s; };
  const rect = (e) => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; };
  const cv = document.createElement('canvas'); cv.width = cv.height = 1; const g = cv.getContext('2d', { willReadFrequently: true });
  const cc = new Map();
  const rgba = (v) => { if (cc.has(v)) return cc.get(v); g.clearRect(0, 0, 1, 1); g.fillStyle = '#000'; g.fillStyle = v; g.fillRect(0, 0, 1, 1); const d = g.getImageData(0, 0, 1, 1).data; const r = [d[0], d[1], d[2], d[3] / 255]; cc.set(v, r); return r; };
  const over = (top, bot) => { const a = top[3]; return [top[0] * a + bot[0] * (1 - a), top[1] * a + bot[1] * (1 - a), top[2] * a + bot[2] * (1 - a), 1]; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  const bgOf = (e) => { const layers = []; for (let n = e; n && n.nodeType === 1; n = n.parentElement) { const c = rgba(cs(n).backgroundColor); if (c[3] > 0) layers.push(c); if (c[3] >= 1) break; } let base = [255, 255, 255, 1]; const bb = rgba(cs(document.body).backgroundColor); if (bb[3] > 0) base = over(bb, base); for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base); return base; };
  const all = [...document.querySelectorAll('body *')].filter((e) => !['SCRIPT', 'STYLE', 'CANVAS', 'PATH', 'USE', 'DEFS', 'LINE', 'CIRCLE', 'RECT', 'G', 'POLYGON', 'POLYLINE', 'ELLIPSE', 'TITLE'].includes(e.tagName.toUpperCase()) && isVisible(e));
  const INTER = 'button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=menuitem], [role=checkbox], [role=switch], [role=option], summary';
  const inter = all.filter((e) => e.matches(INTER));
  const name = (e) => { const a = e.getAttribute('aria-label'); if (a && a.trim()) return a.trim(); const lb = e.getAttribute('aria-labelledby'); if (lb) { const t = lb.split(/\\s+/).map((i) => document.getElementById(i)?.textContent ?? '').join(' ').trim(); if (t) return t; } const t = e.getAttribute('title'); if (t && t.trim()) return t.trim(); const tx = (e.textContent || '').replace(/\\s+/g, ' ').trim(); if (tx) return tx; const im = e.querySelector('img[alt]'); if (im && im.alt.trim()) return im.alt.trim(); if (e.labels && e.labels.length) return e.labels[0].textContent.trim(); if (e.value && e.type !== 'range' && typeof e.value === 'string' && e.value.trim() && e.tagName === 'INPUT' && /button|submit/.test(e.type)) return e.value; const p = e.getAttribute('placeholder'); if (p) return p; return ''; };

  // panels: outermost fixed/absolute visible boxes that carry content, not the canvas or a full-screen stage
  const cvs = [...document.querySelectorAll('canvas')];
  const hasBox = (e) => { const s = cs(e); return rgba(s.backgroundColor)[3] > 0.05 || s.boxShadow !== 'none' || (parseFloat(s.borderTopWidth) > 0 && rgba(s.borderTopColor)[3] > 0); };
  const posCand = all.filter((e) => { const s = cs(e); if (s.position !== 'fixed' && s.position !== 'absolute') return false; if (s.pointerEvents === 'none' || e.getAttribute('role') === 'tooltip' || /(^|\\s)tip(\\s|$)/.test(e.className)) return false; const r = e.getBoundingClientRect(); if (r.width < 40 || r.height < 20) return false; if (r.width * r.height > 0.7 * vw * vh) return false; if (cvs.some((c) => e.contains(c))) return false; if (!hasBox(e) && !e.querySelector(INTER)) return false; if (!(e.querySelector(INTER) || (e.textContent || '').trim().length > 2)) return false; return true; });
  const panels = posCand.filter((e) => !posCand.some((o) => o !== e && o.contains(e)));
  const boxes = panels.filter(hasBox);
  const overlaps = [];
  for (let i = 0; i < panels.length; i++) for (let j = i + 1; j < panels.length; j++) {
    const a = panels[i].getBoundingClientRect(), b = panels[j].getBoundingClientRect();
    const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (w > 4 && h > 4) overlaps.push({ a: sel(panels[i]), b: sel(panels[j]), aRect: rect(panels[i]), bRect: rect(panels[j]), area: Math.round(w * h) });
  }

  // outside viewport / clipped by an overflow ancestor. A control hidden inside a scrolling container is reported once per container ("needs scrolling").
  const outside = [], clipped = [], scrolled = new Map();
  const scrollable = (s, n) => ((s.overflowY === 'auto' || s.overflowY === 'scroll') && n.scrollHeight > n.clientHeight + 1) || ((s.overflowX === 'auto' || s.overflowX === 'scroll') && n.scrollWidth > n.clientWidth + 1);
  for (const e of [...inter, ...panels]) {
    const r = e.getBoundingClientRect();
    let cl = { l: 0, t: 0, r: vw, b: vh }, scroller = null;
    for (let n = e.parentElement; n && n !== document.body; n = n.parentElement) { const s = cs(n); if (s.overflowX !== 'visible' || s.overflowY !== 'visible') { const q = n.getBoundingClientRect(); const before = { ...cl }; cl = { l: Math.max(cl.l, q.left), t: Math.max(cl.t, q.top), r: Math.min(cl.r, q.right), b: Math.min(cl.b, q.bottom) }; if (!scroller && scrollable(s, n) && (r.bottom > q.bottom + 1 || r.top < q.top - 1 || r.right > q.right + 1 || r.left < q.left - 1)) scroller = n; } }
    const iw = Math.min(r.right, cl.r) - Math.max(r.left, cl.l), ih = Math.min(r.bottom, cl.b) - Math.max(r.top, cl.t);
    const frac = Math.max(0, iw) * Math.max(0, ih) / (r.width * r.height);
    if (scroller) { const k = sel(scroller); scrolled.set(k, (scrolled.get(k) ?? 0) + (frac < 0.9 ? 1 : 0)); continue; }
    if (r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1) outside.push({ el: sel(e), name: name(e).slice(0, 40), rect: rect(e) });
    else if (frac < 0.9) clipped.push({ el: sel(e), name: name(e).slice(0, 40), visiblePct: Math.round(frac * 100) });
  }
  const needsScroll = [...scrolled].filter(([k, n]) => n > 0).map(([el, hidden]) => ({ el, controlsHiddenBelowFold: hidden }));

  // text overflow
  const overflow = [];
  for (const e of all) { if (e.children.length > 3 || e.id === 'root') continue; { const q = e.getBoundingClientRect(); if (q.width * q.height > 0.5 * vw * vh) continue; } const s = cs(e); const tx = (e.textContent || '').trim(); if (!tx) continue; if (e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0 && (s.overflowX !== 'visible' || s.textOverflow === 'ellipsis')) overflow.push({ el: sel(e), text: tx.slice(0, 40), scrollWidth: e.scrollWidth, clientWidth: e.clientWidth, ellipsis: s.textOverflow === 'ellipsis' }); }

  // targets and names
  const tiny = [], small = [], unnamed = [];
  for (const e of inter) { const r = e.getBoundingClientRect(); const dis = e.disabled || e.getAttribute('aria-disabled') === 'true'; const isRange = e.matches('input[type=range], input[type=checkbox], input[type=radio]');
    if (!isRange && (r.width < T.tinyPx || r.height < T.tinyPx)) tiny.push({ el: sel(e), name: name(e).slice(0, 30), size: [Math.round(r.width), Math.round(r.height)], disabled: !!dis });
    else if (!isRange && (r.width < T.smallPx || r.height < T.smallPx)) small.push({ el: sel(e), name: name(e).slice(0, 30), size: [Math.round(r.width), Math.round(r.height)] });
    if (!name(e)) unnamed.push({ el: sel(e), rect: rect(e), html: e.outerHTML.slice(0, 120) }); }

  // duplicates: same accessible name, or the same icon, in two visible places
  const byName = new Map(), byIcon = new Map();
  const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; };
  for (const e of inter) { if (e.closest('[role=listbox],[role=menu],[role=dialog]')) continue; const n = name(e).toLowerCase(); if (n.length > 1) { (byName.get(n) ?? byName.set(n, []).get(n)).push(e); }
    const svg = e.querySelector('svg'); if (svg && !(e.textContent || '').trim()) { const k = hash(svg.innerHTML); (byIcon.get(k) ?? byIcon.set(k, []).get(k)).push(e); } }
  const dupNames = [...byName].filter(([n, a]) => a.length > 1).map(([n, a]) => ({ name: n, count: a.length, where: a.map((e) => sel(e) + '@' + rect(e).slice(0, 2).join(',')) }));
  const dupIcons = [...byIcon].filter(([k, a]) => a.length > 1 && new Set(a.map((e) => name(e).toLowerCase())).size > 1 || false).map(([k, a]) => ({ names: [...new Set(a.map((e) => name(e)))], count: a.length }));
  const dupIconSame = [...byIcon].filter(([k, a]) => a.length > 1 && new Set(a.map((e) => name(e).toLowerCase())).size === 1).length;

  // contrast
  const lowText = [], lowIcon = []; const seen = new Set();
  for (const e of all) { if (e.disabled || e.closest('[disabled],[aria-disabled=true]')) continue; const s = cs(e);
    const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
    if (own) { const fg0 = rgba(s.color); const bg = bgOf(e); const fg = over(fg0, bg); const r = ratio(fg, bg); const px = parseFloat(s.fontSize); const bold = parseInt(s.fontWeight) >= 700; const large = px >= 24 || (px >= 18.66 && bold); const need = large ? 3 : T.contrastText;
      if (r < need) { const k = sel(e) + fg.join() + bg.join(); if (!seen.has(k)) { seen.add(k); lowText.push({ el: sel(e), text: e.textContent.trim().slice(0, 30), ratio: +r.toFixed(2), need, fg: fg.slice(0, 3).map(Math.round), bg: bg.slice(0, 3).map(Math.round) }); } } }
    if (e.tagName.toLowerCase() === 'svg' && e.closest(INTER) && !e.closest('[disabled],[aria-disabled=true]')) { const stroke = s.stroke !== 'none' ? s.stroke : s.fill; const fg0 = rgba(stroke === 'none' || !stroke ? s.color : stroke); const bg = bgOf(e); const fg = over(fg0, bg); const r = ratio(fg, bg); if (r < T.contrastIcon) { const k = 'i' + sel(e.parentElement) + fg.join() + bg.join(); if (!seen.has(k)) { seen.add(k); lowIcon.push({ el: sel(e.closest(INTER)), name: name(e.closest(INTER)).slice(0, 30), ratio: +r.toFixed(2) }); } } } }

  // consistency sets
  const radii = new Set(), shadows = new Set(), sizes = new Map(), fams = new Set(); const tinyText = [];
  for (const e of [...panels, ...inter]) { const s = cs(e); if (s.borderRadius !== '0px') radii.add(s.borderRadius); if (s.boxShadow !== 'none') shadows.add(s.boxShadow); }
  for (const e of all) { const s = cs(e); if ([...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) { const px = parseFloat(s.fontSize); sizes.set(px, (sizes.get(px) ?? 0) + 1); fams.add(s.fontFamily.split(',')[0].replace(/["']/g, '').trim()); if (px < T.minFontPx) tinyText.push({ el: sel(e), text: e.textContent.trim().slice(0, 24), px }); } }

  return {
    viewport: [vw, vh], theme: document.documentElement.getAttribute('data-theme'), counts: { visibleElements: all.length, interactive: inter.length, panels: panels.length, floatingBoxes: boxes.length },
    floatingBoxes: boxes.map((e) => ({ el: sel(e), rect: rect(e) })),
    overlaps, needsScroll, outside: cap(outside), clipped: cap(clipped), textOverflow: cap(overflow), tinyTargets: cap(tiny, 30), smallTargets: small.length, smallTargetsSample: cap(small, 10), unnamed: cap(unnamed), dupNames: cap(dupNames, 20), dupIcons: cap(dupIcons), dupIconSameName: dupIconSame,
    lowContrastText: cap(lowText, 20), lowContrastIcons: cap(lowIcon), lowContrastTextCount: lowText.length,
    consistency: { borderRadii: [...radii], shadows: shadows.size, fontSizes: [...sizes.keys()].sort((a, b) => a - b), fontFamilies: [...fams], textBelowMin: cap(tinyText, 10), textBelowMinCount: tinyText.length },
  };
}`;

const FOCUS = `(() => { const e = document.activeElement; if (!e || e === document.body) return { body: true };
  const r = e.getBoundingClientRect(); const s = getComputedStyle(e); let vis = r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  const inView = r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight;
  let clip = false; for (let n = e.parentElement; n; n = n.parentElement) { const o = getComputedStyle(n); if (o.overflowX !== 'visible' || o.overflowY !== 'visible') { const q = n.getBoundingClientRect(); if (r.right < q.left || r.left > q.right || r.bottom < q.top || r.top > q.bottom) clip = true; } }
  const ring = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none';
  return { tag: e.tagName.toLowerCase(), cls: (typeof e.className === 'string' ? e.className : '').slice(0, 40), label: (e.getAttribute('aria-label') || e.title || e.textContent || '').trim().slice(0, 30), visible: vis && inView && !clip, ring }; })()`;

export async function collectMetrics(page) {
  const m = await page.eval(`(${SCAN})(${JSON.stringify(THRESHOLDS)})`);
  // focus walk: real Tab key presses from the document start
  const stops = [];
  try {
    await page.eval(`(document.activeElement && document.activeElement.blur && document.activeElement.blur(), 0)`);
    for (let i = 0; i < 20; i++) { await page.key('Tab'); stops.push(await page.eval(FOCUS)); }
  } catch { /* page navigated or closed */ }
  m.focus = { stops, hidden: stops.filter((s) => !s.body && !s.visible).length, noRing: stops.filter((s) => !s.body && s.visible && !s.ring).length, bodyStops: stops.filter((s) => s.body).length };
  return m;
}

/** Findings as [severity, text] pairs: the report table and the pass/fail summary come from here. */
export function findings(m) {
  const T = THRESHOLDS, f = [];
  const add = (sev, text) => f.push([sev, text]);
  if (m.counts.floatingBoxes > T.floatingPanels) add('major', `${m.counts.floatingBoxes} floating boxes visible at once (limit ${T.floatingPanels})`);
  for (const o of m.overlaps) add('major', `panels overlap: ${o.a} and ${o.b} (${o.area}px2)`);
  for (const o of m.needsScroll) add('minor', `${o.controlsHiddenBelowFold} controls hidden below the fold in ${o.el} (needs scrolling)`);
  for (const o of m.outside) add('minor', `extends outside viewport: ${o.el} "${o.name}" ${o.rect.join(',')}`);
  for (const o of m.clipped) add('minor', `clipped to ${o.visiblePct}%: ${o.el} "${o.name}"`);
  if (m.textOverflow.length) add('minor', `${m.textOverflow.length} text overflow/ellipsis, e.g. ${m.textOverflow[0].el} "${m.textOverflow[0].text}"`);
  const tinyEnabled = m.tinyTargets.filter((t) => !t.disabled);
  if (tinyEnabled.length) add('major', `${tinyEnabled.length} click targets under ${T.tinyPx}px, e.g. ${tinyEnabled[0].el} "${tinyEnabled[0].name}" ${tinyEnabled[0].size.join('x')}`);
  if (m.smallTargets) add('nit', `${m.smallTargets} targets under ${T.smallPx}px`);
  if (m.unnamed.length) add('major', `${m.unnamed.length} controls without an accessible name, e.g. ${m.unnamed[0].el}`);
  for (const d of m.dupNames) add('minor', `duplicate control "${d.name}" x${d.count}`);
  for (const d of m.dupIcons) add('nit', `same icon on differently named controls: ${d.names.join(' / ')}`);
  if (m.lowContrastTextCount) add('major', `${m.lowContrastTextCount} low-contrast text, worst ${Math.min(...m.lowContrastText.map((x) => x.ratio))}:1, e.g. ${m.lowContrastText[0].el} "${m.lowContrastText[0].text}"`);
  if (m.lowContrastIcons.length) add('minor', `${m.lowContrastIcons.length} low-contrast icons, e.g. "${m.lowContrastIcons[0].name}" ${m.lowContrastIcons[0].ratio}:1`);
  const c = m.consistency;
  if (c.borderRadii.length > T.radii) add('minor', `${c.borderRadii.length} distinct border radii (limit ${T.radii})`);
  if (c.shadows > T.shadows) add('minor', `${c.shadows} distinct shadows (limit ${T.shadows})`);
  if (c.fontSizes.length > T.fontSizes) add('minor', `${c.fontSizes.length} distinct font sizes (limit ${T.fontSizes}): ${c.fontSizes.join(', ')}`);
  if (c.fontFamilies.length > T.fontFamilies) add('minor', `${c.fontFamilies.length} font families: ${c.fontFamilies.join(', ')}`);
  if (c.textBelowMinCount) add('minor', `${c.textBelowMinCount} text runs under ${T.minFontPx}px`);
  if (m.focus.hidden) add('major', `${m.focus.hidden} of the first 20 Tab stops are not visible`);
  if (m.focus.noRing > 3) add('minor', `${m.focus.noRing} Tab stops show no focus indicator`);
  return f;
}
