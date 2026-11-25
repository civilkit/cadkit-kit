// The go-live gate, shared by tools/release.mjs and tools/deploy_site.mjs. It LOOKS UP, never remembers:
//  - the kit CI (full tier: tsc, kernel typecheck, vitest against the real kernel) must be GREEN on the exact kit commit, read from the box's history;
//  - the kernel being shipped must be the commit in tools/ci/LAST_GREEN of the kernel checkout (the last green full kernel gate), and when a wasm path is
//    given its folder name (<time>-<sha10>/ck_wasm.wasm, written by tools/ci/full_gate_on_main.sh) must name that same commit.
//  - a commit with no verdict of its own may use its PARENT's GREEN full-tier verdict when it is a pure "Release X.Y.Z" commit (rule 1 in tools/gate_rules.mjs: version lines,
//    CHANGELOG heading and generated What's new page only); the kernel check below is the same either way. A RED/FLAKY verdict on the commit itself is never overridden.
// Returns a list of problems; empty means go. There is deliberately no bypass: a red or unchecked commit goes back to be fixed.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { kitCiVerdict } from './gate_rules.mjs';
import { INDEX_PATH, committedText, regenerateWhatsNew } from './gate_regen.mjs';

const git = (dir, ...args) => { const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' }); if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr.trim()}`); return r.stdout.trim(); };

export function ciGate({ root, kernelRepo, kernelRef = 'HEAD', wasm, log = console.log }) {
  const problems = [];
  const head = git(root, 'rev-parse', 'HEAD');
  const r = spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', 'ci-box', 'tail -n 200 /path/to/ci'], { encoding: 'utf8' });
  if (r.status !== 0) problems.push(`cannot read the kit CI history from the box (${(r.stderr || '').split('\n').filter((l) => l && !l.startsWith('**')).join(' ').slice(0, 160)})`);
  else {
    const recs = r.stdout.split('\n').filter((l) => l.startsWith('{')).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
    // Release-commit rule (tools/gate_rules.mjs): only ever consulted when the commit has no verdict of its own; any git trouble means the plain rule applies
    let facts = {};
    try {
      const parent = git(root, 'rev-parse', `${head}^`);
      facts = { parent, subject: git(root, 'log', '-1', '--format=%s', head), tagsAtCommit: git(root, 'tag', '--points-at', head).split('\n').filter(Boolean),
        diffText: git(root, 'diff', '--no-color', '--no-renames', '--no-ext-diff', `${parent}..${head}`),
        indexHtml: committedText(root, head, INDEX_PATH), regenerate: () => regenerateWhatsNew(root, head) };
    } catch { /* no parent or no diff: plain rule */ }
    const v = kitCiVerdict({ head, recs, ...facts });
    problems.push(...v.problems);
    if (v.note) log(`gate: ${v.note}`);
  }
  if (kernelRepo) {
    const kfull = git(kernelRepo, 'rev-parse', kernelRef);
    let green = '';
    try { green = readFileSync(join(kernelRepo, 'tools/ci/LAST_GREEN'), 'utf8').trim().split(/\s+/)[0]; } catch { /* none */ }
    if (green !== kfull) problems.push(`the kernel ${kfull.slice(0, 10)} is not the last green full gate (${green ? green.slice(0, 10) : 'none recorded'}): run tools/ci/full_gate_on_main.sh`);
    if (wasm) {
      const m = /-([0-9a-f]{10})\/[^/]*$/.exec(wasm);
      if (!m) problems.push(`the wasm ${wasm} is not from a full-gate run folder (<time>-<sha10>/): use the wasm the full gate wrote`);
      else if (!kfull.startsWith(m[1])) problems.push(`the wasm was built from ${m[1]}, not from the kernel ${kfull.slice(0, 10)} being shipped`);
    }
  }
  return problems;
}
