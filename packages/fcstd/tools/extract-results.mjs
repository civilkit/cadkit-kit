// Collect the corpus report of a remote run: node packages/fcstd/tools/extract-results.mjs <vitest-log>
// (UPDATE_CORPUS=1 tools/remote_vitest.sh ... prints RESULTS.md / RESULTS.json / expected.json between @@ markers).
import { readFileSync, writeFileSync } from 'node:fs';
const text = readFileSync(process.argv[2], 'utf8');
const dir = new URL('../corpus/', import.meta.url).pathname;
for (const [tag, file] of [['RESULTS_MD', 'RESULTS.md'], ['RESULTS_JSON', 'RESULTS.json'], ['EXPECTED_JSON', 'expected.json']]) {
  const m = text.match(new RegExp(`@@${tag}@@\\n([\\s\\S]*?)@@END@@`));
  if (!m) { console.error(`no ${tag} in the log`); process.exitCode = 1; continue; }
  writeFileSync(dir + file, m[1].replace(/\n+$/, '\n'));
  console.log('wrote', file);
}
