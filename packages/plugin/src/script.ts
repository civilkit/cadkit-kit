// A generator that is a script (installed plugins). The script is written in the app's script dialect; the host puts two things in scope:
// `params` (the checked values, frozen) and `uniqueName(base)` ("Plate", then "Plate 2" ... against the names the document already uses).
// The result is ordinary script text that the app's runner executes on the scratch build, exactly like a script the user typed.
import type { GenerateFn } from './registry';

export const scriptGenerator = (source: string): GenerateFn => (values, ctx) =>
  `const params = Object.freeze(${JSON.stringify(values)});\n`
  + `const uniqueName = (base) => { const used = ${JSON.stringify(ctx.used)}; if (!used.includes(base)) return base; for (let n = 2; ; n++) if (!used.includes(base + ' ' + n)) return base + ' ' + n; };\n`
  + source;
