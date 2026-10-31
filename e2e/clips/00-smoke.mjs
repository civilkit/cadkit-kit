// Pipeline check: open the Script panel, run a tiny script, watch the part appear. Not a shipped clip.
import { sleep } from './lib.mjs';

const CODE = `part('Smoke').sketch('front', (s) => s.rect(40, 30)).extrude(12).fillet(edges('|Z'), 4);\n`;

export default {
    id: 'smoke',
    async run(rec) {
        const { page } = rec;
        await rec.begin();
        await rec.click(page.getByRole('button', { name: /script/i }).first());
        await sleep(600);
        await page.evaluate((t) => { const ta = document.querySelector('textarea.script-ta'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, t); ta.dispatchEvent(new Event('input', { bubbles: true })); }, CODE);
        await sleep(800);
        await rec.click(page.getByRole('button', { name: /^run$/i }).first());
        await rec.waitFor(/Features 3/);
        await sleep(900);
        await rec.finish();
    },
};
