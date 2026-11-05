// Makes a 500 ml PET bottle in the CAD app with the sketcher: outline with typed lengths, a spline shoulder, Revolve,
// petal sketch with a circular pattern, a drafted Cut, and Shell. (Developed with e2e/clips/dry.mjs.)
import { sleep } from './lib.mjs';

/** Typed segment of the Line tool: length, Tab, angle, Enter. */
async function seg(rec, len, ang) {
    const { page } = rec;
    const fields = page.locator('.sketch-fields input');
    // the fields follow the pointer: a small move over free canvas makes the new rubber band (and its fields) appear
    for (let i = 0; i < 6 && !(await fields.count()); i++) { await page.mouse.move(1000 + i * 3, 520 + (i % 2) * 3); await sleep(250); }
    await fields.first().waitFor({ timeout: 10000 });
    // focus the length field and select what it shows, so the first typed character is not lost to a field that is still appearing
    await fields.first().focus(); await page.evaluate(() => document.querySelector('.sketch-fields input')?.select());
    await rec.type(String(len), 60);
    await page.keyboard.press('Tab');
    await rec.type(String(ang), 60);
    await page.keyboard.press('Enter');
    await sleep(350);
}

/** The sketch point under the pointer, read from the status bar (it shows the snapped value). */
async function readCoords(page) {
    let t = '';
    for (let i = 0; i < 12; i++) {
        t = (await page.getByTestId('status-coords').textContent()) ?? '';
        const m = t.match(/(-?[\d.]+)\s*mm,\s*(-?[\d.]+)\s*mm/);
        if (m) return [Number(m[1]), Number(m[2])];
        await page.mouse.move(900 + (i % 3), 430 + (i % 2)); await sleep(150);
    }
    throw new Error(`cannot read coordinates from "${t}"`);
}

/** Signed millimetres per pixel on both axes (the view can look from below, which mirrors X), measured from two hovers. */
async function axes(page) {
    await page.mouse.move(1000, 400); await sleep(250);
    const [x0, y0] = await readCoords(page);
    await page.mouse.move(1100, 500); await sleep(250);
    const [x1, y1] = await readCoords(page);
    return { x0, y0, kx: (x1 - x0) / 100, ky: (y1 - y0) / 100 };
}

/** Finds the pixel that snaps to the sketch point (x, y) mm: starts from the measured mapping and corrects from the status bar until it reads the point. */
async function pixelFor(rec, x, y, A) {
    const { page } = rec;
    let px = 1000 + (x - A.x0) / A.kx, py = 400 + (y - A.y0) / A.ky;
    const tryAt = async (qx, qy) => { await page.mouse.move(qx, qy); await sleep(140); const [mx, my] = await readCoords(page); return { mx, my, hit: Math.abs(mx - x) < 0.2 && Math.abs(my - y) < 0.2 }; };
    for (let i = 0; i < 4; i++) {
        const r = await tryAt(px, py);
        if (r.hit) return [px, py];
        px += (x - r.mx) / A.kx; py += (y - r.my) / A.ky;
    }
    // the snap can hold on to a guide or the other axis: search the neighbourhood in small steps (the pointer moves in from the same side each time)
    for (const d of [3, 6, 9, 12]) {
        for (const [ox, oy] of [[0, d], [0, -d], [d, 0], [-d, 0], [d, d], [-d, d], [d, -d], [-d, -d]]) {
            const r = await tryAt(px + ox, py + oy);
            if (r.hit) return [px + ox, py + oy];
        }
    }
    const [lx2, ly2] = await readCoords(page);
    throw new Error(`no pixel snaps to (${x}, ${y}); last pixel ${px.toFixed(1)},${py.toFixed(1)} reads ${lx2},${ly2}; axes ${JSON.stringify(A)}`);
}
let SCALE = 3;

// lengths are typed at full precision so the outline closes exactly
const D = 10 * Math.SQRT2;

export default {
    id: 'pet-bottle',
    viewport: { width: 1600, height: 900 },
    maxBytes: 12_000_000,
    async run(rec) {
        const { page } = rec;
        await rec.begin();
        await rec.caption('Sketch the outline: type each length and angle');
        await rec.click(page.getByRole('button', { name: /sketch on front plane/i }));
        await rec.skip(() => sleep(900));
        await rec.shot('01-sketch');
        // the first point typed: Tab shows X and Y
        await rec.glide(720, 470, 500);
        await page.keyboard.press('Tab');
        await rec.type('0'); await page.keyboard.press('Tab'); await rec.type('10'); await page.keyboard.press('Enter');
        await sleep(300);
        await rec.glide(780, 430, 400);
        // outline up the right side: base, standing ring, bevel, straight body
        rec.zoom(780, 430, 1.7);         // the typed fields and dimensions follow the pointer
        await seg(rec, 5, 0);            // flat centre of the push-up
        await seg(rec, D, -45);          // push-up cone
        await seg(rec, 10, 0);           // standing ring
        await seg(rec, D, 45);           // base bevel
        await seg(rec, 120, 90);         // straight body up to y = 130
        rec.zoomOut();
        await rec.shot('02-body');
        let lx, ly;
        if (process.env.NOSPLINE) {
            await seg(rec, Math.hypot(20, 50), Math.atan2(50, -20) * 180 / Math.PI);   // test variant: straight shoulder
        } else {
            // the shoulder is a spline: pick the tool, fit the view, then click grid points (the first on the end of the body line)
            await rec.caption('The shoulder is one smooth spline');
            await rec.click(page.getByTestId('slot-spline'));
            await rec.click(page.locator('[aria-label="Fit" i], [title^="Fit" i]').first());
            await rec.skip(() => sleep(700));
            await rec.shot('03-fit');
            // grid of 5 mm, then find the pixels that snap to the shoulder points
            // zoom out so the whole bottle height (about 200 mm) is in view
            const zm = page.getByTestId('status-zoom');
            await zm.click(); await zm.fill('55'); await zm.press('Enter'); await sleep(500);
            const sp = page.getByTestId('status-spacing');
            await sp.click(); await sp.fill('5'); await sp.press('Enter'); await sleep(400);
            await page.mouse.move(900, 400); await sleep(200);
            const A = await axes(page);
            if (process.env.SCAN) { const out = []; for (let yy = 330; yy <= 420; yy += 5) { await page.mouse.move(840, yy); await sleep(120); out.push(yy + ':' + (await readCoords(page)).join(',')); } console.log('SCAN', out.join(' ')); }
            const pts = [[35, 130], [35, 150], [25, 170], [15, 180]];   // the aligned snap steps by 10 mm along a vertical guide
            const px = [];
            for (const [r, y] of pts) px.push(await pixelFor(rec, r, y, A));
            for (const [x, y] of px) { await rec.clickAt(x, y, 450); await sleep(150); }
            await rec.shot('04-spline');
            [lx, ly] = px[px.length - 1];
            await page.mouse.dblclick(lx, ly); await sleep(400);
            await rec.shot('05-spline-done');

        }
        // back to the Line tool: start on the spline's end point, then the neck, the support ring and the mouth
        await rec.caption('Finish the neck, ring and mouth, then close on the axis');
        if (lx !== undefined) { await rec.click(page.getByTestId('slot-line')); await rec.clickAt(lx, ly, 450); }
        await seg(rec, 10, 90);          // neck up to y = 190
        await seg(rec, 5, 0);            // support ring out
        await seg(rec, 5, 90);
        await seg(rec, 5, 180);
        await seg(rec, 5, 90);           // finish up to the mouth, y = 200
        await rec.shot('06a-mouth');
        await seg(rec, 15, 180);         // the mouth across to the axis
        await rec.shot('06b-across');
        await seg(rec, 190, -90);        // down the axis back to the first point: the loop closes
        await rec.skip(() => sleep(900));
        await page.keyboard.press('Escape'); await sleep(400);
        await rec.shot('06-closed');
        // Revolve the closed outline: the axis defaults to the sketch's vertical axis
        await rec.caption('Revolve the closed outline around the axis');
        await rec.click(page.getByTestId('cmd-sketch-revolve'));
        await rec.skip(() => sleep(1200));
        await rec.shot('07-revolve-card');
        console.log('CARD:', ((await page.locator('.editor, [class*=editor], [data-testid=feature-card]').first().innerText().catch(() => '')) || '').replace(/\s+/g, ' ').slice(0, 600));
        console.log('OPEN:', await page.evaluate(() => { const hit = [...document.querySelectorAll('*')].filter((e) => /This profile is open/.test(e.textContent ?? '') && e.children.length < 8).sort((x, y) => (x.textContent ?? '').length - (y.textContent ?? '').length)[0]; return hit ? (hit.textContent ?? '').replace(/\s+/g, ' ').slice(0, 300) : 'none'; }));
        await rec.zoomOn(page.getByTestId('feature-ok'), 1.6, -120, -80); await sleep(900); rec.zoomOut();
        await rec.click(page.getByTestId('feature-ok'));
        await rec.waitFor(/Features\s*[1-9]/);
        await rec.skip(() => sleep(800));
        await rec.shot('08-revolved');
        // the petals: a sketch on the Top plane (the standing plane of the bottle)
        await rec.click(page.locator('.tree-wrap *', { hasText: /^Top Plane/ }).first());
        await sleep(600);
        await rec.shot('09-top-selected');
        await rec.caption('Petal base: two arcs, repeated five times');
        await rec.click(page.getByTestId('slot-new-sketch'));
        await rec.skip(() => sleep(1500));
        await rec.shot('10-petal-sketch');
        // two three-point arcs make one petal: start, end, then a point on the arc
        const zm2 = page.getByTestId('status-zoom');
        await zm2.click(); await zm2.fill('140'); await zm2.press('Enter'); await sleep(600);
        const AP = await axes(page);
        console.log('PETAL AXES', JSON.stringify(AP));
        await rec.click(page.getByTestId('slot-arc-three-point'));
        const arcPts = async (a, b, m) => {
            for (const [x, y] of [a, m, b]) { const p = await pixelFor(rec, x, y, AP); await rec.clickAt(p[0], p[1], 450); await sleep(200); }
        };
        await arcPts([10, 0], [40, 0], [25, 5]);   // slim petals: neighbours do not overlap (a sliver between them breaks the shell later)
        await rec.shot('11-arc1');
        await arcPts([40, 0], [10, 0], [25, -5]);
        await rec.shot('12-arc2');
        // the circular pattern lives in the Offset group
        { const bb = await page.getByTestId('slot-offset').boundingBox(); await rec.clickAt(bb.x + bb.width - 7, bb.y + bb.height - 7, 500); }
        await rec.skip(() => sleep(700));
        await rec.shot('13-offset-menu');
        await rec.click(page.getByText('Circular pattern', { exact: true }).first());
        await sleep(600);
        // select both arcs of the petal (click on each arc where it bulges), then Enter
        for (const [x, y] of [[25, 5], [25, -5]]) { const p = await pixelFor(rec, x, y, AP); await rec.clickAt(p[0], p[1], 450); await sleep(250); }
        await rec.shot('14-arcs-selected');
        await page.keyboard.press('Enter'); await sleep(500);
        // the centre: the sketch origin
        { const p = await pixelFor(rec, 0, 0, AP); await rec.clickAt(p[0], p[1], 450); await sleep(500); }
        await rec.shot('15-centre');
        // five petals: the count field takes the number, Enter makes the copies
        await page.locator('.sketch-fields input').first().focus();
        await page.evaluate(() => document.querySelector('.sketch-fields input')?.select());
        await rec.type('5', 90);
        await page.keyboard.press('Tab'); await sleep(250);
        await rec.shot('16-count5');
        await page.keyboard.press('Enter'); await rec.skip(() => sleep(700));
        await rec.shot('17a-enter1');
        await page.keyboard.press('Enter'); await rec.skip(() => sleep(900));
        await rec.shot('17-pattern-done');
        // cut the petals into the base: Extrude from the petal sketch
        await rec.caption('Cut the petals up into the base with a 10 degree draft');
        await rec.click(page.getByTestId('cmd-sketch-extrude'));
        await rec.skip(() => sleep(1500));
        await rec.shot('18-extrude-card');
        await rec.click(page.locator('button', { hasText: /^Cut$/ }).last());
        await sleep(500);
        const depth = page.locator('input[aria-label="Depth"]');
        await rec.click(depth); await page.evaluate(() => document.activeElement?.select?.()); await rec.type('12', 90); await page.keyboard.press('Tab'); await rec.skip(() => sleep(900));
        const draft = page.locator('input[aria-label="Draft angle"]');
        await rec.click(draft); await page.evaluate(() => document.activeElement?.select?.()); await rec.type('10', 90); await page.keyboard.press('Tab');
        await rec.skip(() => sleep(1200));
        await rec.shot('19-cut-set');
        // the cut must go up into the bottle: flip the direction
        await rec.click(page.getByLabel('Flip direction'));
        await rec.skip(() => sleep(1500));
        await rec.shot('20-flipped');
        await rec.click(page.getByTestId('feature-ok'));
        await rec.waitFor(/Features\s*[3-9]/);
        await rec.skip(() => sleep(800));
        await rec.shot('21-cut-done');
        if (process.env.SAVE_DOC) {
            await rec.skip(() => sleep(3000));
            const dump = await page.evaluate(async () => {
                const out = { ls: Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)?.length]) };
                const dbs = await (indexedDB.databases?.() ?? []);
                out.dbs = dbs.map((d) => d.name);
                return out;
            });
            console.log('STORE', JSON.stringify(dump).slice(0, 300));
            const raw = await page.evaluate(() => localStorage.getItem('cad.autosave.v1'));
            (await import('node:fs')).writeFileSync(process.env.SAVE_DOC, raw ?? '');
        }
        // Shell: look down on the bottle, pick the mouth face, Shell with a thin wall
        await page.keyboard.press('Escape'); await sleep(200);
        await page.keyboard.press('1'); await rec.skip(() => sleep(1200));
        await page.keyboard.press('z'); await rec.skip(() => sleep(900));
        await rec.shot('22-top-view');
        await rec.clickAt(800, 530, 600);
        await sleep(600);
        await rec.shot('23-face-picked');
        await rec.caption('Shell the bottle from the mouth: 0.35 mm wall');
        await rec.click(page.getByTestId('cmd-add-shell'));
        await rec.skip(() => sleep(1200));
        await rec.shot('24-shell-card');
        // wall thickness 0.35 and confirm
        const wall = page.locator('input[aria-label="Wall thickness"]');
        await rec.click(wall); await page.evaluate(() => document.activeElement?.select?.()); await rec.type('0.35', 90); await page.keyboard.press('Tab');
        await rec.skip(() => sleep(2500));
        await rec.shot('25-shell-set');
        await rec.click(page.getByTestId('feature-ok'));
        await rec.skip(() => sleep(2500));
        await page.keyboard.press('7'); await rec.skip(() => sleep(900));
        await page.keyboard.press('z'); await rec.skip(() => sleep(1200));
        await rec.shot('26-done');
        await rec.caption('A 500 ml PET bottle in seven features');
        rec.mark('poster');
        // a slow turn of the finished bottle
        await rec.glide(900, 600, 500);
        await page.mouse.down();
        await rec.glide(1050, 560, 1500);
        await page.mouse.up();
        await sleep(1200);
        await rec.caption('');
        rec.zoomOut();
        await rec.finish();
    },
};
