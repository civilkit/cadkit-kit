// The bearings example for the Script tab. docs/examples/bearings.script.ts is the readable copy; a test keeps the two equal.
export const BEARINGS_SCRIPT: string = [
  "// Bearings: a row of deep-groove ball bearings by designation (nominal ISO 15 sizes), with a flat shield (2Z), a seal (2RS) or open with visible balls.",
  "// Paste into the Script tab and Run (a few seconds). Each ring and each ball is its own body, the first face of every bearing on the XY plane.",
  "// The races are plain cylinders without ball grooves: for assemblies, fit checks and looks, not for load ratings.",
  "const { spacing } = variables({ spacing: 30 });",
  "const list = [",
  "  { designation: '625', seal: '2Z' },      // the NEMA 17 rear bearing",
  "  { designation: '608', seal: '2RS' },     // skate bearing",
  "  { designation: '6204', seal: 'open' },   // balls visible",
  "  { designation: 'R2', seal: 'open' },     // 1/8 inch bore",
  "];",
  "const p = part('Bearings');",
  "list.forEach((b, i) => p.bearing({ ...b, origin: [i * spacing, 0, 0] }));",
  "",
  "// Any size: bore, od and width in mm instead of a designation (here a 12 x 28 x 8 bearing with a 0.5 mm chamfer)",
  "// p.bearing({ bore: 12, od: 28, width: 8, seal: '2Z', chamfer: 0.5, origin: [0, 40, 0] });",
].join("\n") + "\n";
