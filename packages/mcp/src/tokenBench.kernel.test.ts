// @vitest-environment node
// Runs the token-cost benchmark (bench/mcpBench.ts) and prints the numbers; CK_BENCH_OUT writes them as JSON.
// The baseline is the fixed task through the tools before this branch (BASELINE, measured at commit 45b32348); the task now runs through the new tools.
import { writeFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { BASELINE, runCompactTask, runOpenStep, startBench, type BenchEnv } from '../bench/mcpBench';

const envs: BenchEnv[] = [];
afterAll(async () => { for (const e of envs) await e.close(); });

describe('token benchmark', () => {
  it('open by path: a 26-feature part opened with one small call, the bytes never in the result', async () => {
    const env = await startBench({ bodies: 13 });
    envs.push(env);
    const m = await runOpenStep(env);
    expect(m.isError).toBe(false);
    expect(m.responseChars).toBeLessThan(700);
    const fileChars = JSON.stringify(env.a.doc).length;
    console.log(`BENCH open: request ${m.requestChars} chars, response ${m.responseChars} chars, for a part file of ${fileChars} chars (the only way before was app_run_script, 40000 chars at most)`);
  }, 120000);

  for (const bodies of [13, 100] as const) {
    const features = (bodies * 2) as 26 | 200;
    it(`the fixed task with ${features} features through the new tools costs fewer characters than the baseline`, async () => {
      const env = await startBench({ bodies });
      envs.push(env);
      const c = await runCompactTask(env);
      expect(c.perCall.every((x) => !x.isError), JSON.stringify(c.perCall.filter((x) => x.isError))).toBe(true);
      const b = BASELINE[features];
      console.log('BENCH ' + JSON.stringify({ features, before: b, after: { calls: c.calls, requestChars: c.requestChars, responseChars: c.responseChars, totalChars: c.totalChars, ms: c.ms }, perCall: c.perCall.map((x) => `${x.step}: ${x.tool} req ${x.requestChars} resp ${x.responseChars} ${x.ms}ms`) }));
      expect(c.totalChars).toBeLessThan(b.totalChars);
      if (process.env.CK_BENCH_OUT) writeFileSync(process.env.CK_BENCH_OUT.replace(/\.json$/, `-${features}.json`), JSON.stringify(c, null, 1));
    }, 120000);
  }
});
