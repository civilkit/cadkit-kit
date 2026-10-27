// Bite alarm body (first pass from photos): rounded tapered body, wheel with ring groove and centre hole, left grip pad, right slot, stepped base.
// Sizes are estimates (about 38 x 70 mm from the box photo); change them in the block below once you have a real measurement.
const { W, L, H, wheelD, groove, cornerR } = variables({ W: 38, L: 70, H: 12, wheelD: 23, groove: 1.5, cornerR: 4 });

const wy = 0.2 * L, wx = 0.09 * W;   // wheel centre, toward the top and a little right
const topPlane = at('front', H);

const body = part('Bite alarm body')
  .sketch('front', (s) => s.polygon([
    [-0.46 * W, -L / 2], [0.46 * W, -L / 2], [0.5 * W, -0.35 * L], [0.5 * W, 0.38 * L],
    [0.36 * W, L / 2], [-0.36 * W, L / 2], [-0.5 * W, 0.38 * L], [-0.5 * W, -0.35 * L],
  ]))
  .extrude(H)
  .fillet(edges('|Z'), cornerR)
  // ring groove around the wheel, then the raised wheel and its centre hole
  .sketch(topPlane, (s) => { s.circle(wheelD / 2 + groove, [wx, wy]); s.circle(wheelD / 2, [wx, wy]); })
  .cut(1.5)
  .sketch(topPlane, (s) => s.circle(wheelD / 2 - 0.5, [wx, wy]))
  .extrude(1.5)
  .sketch(at('front', H + 1.5), (s) => s.circle(2.2, [wx, wy]))
  .cut(3)
  // left grip pad
  .sketch(topPlane, (s) => s.rrect(0.26 * W, 0.33 * L, 2, [-0.37 * W, 0.13 * L]))
  .extrude(0.8)
  // right slot
  .sketch(topPlane, (s) => s.rrect(0.11 * W, 0.12 * L, 1.5, [0.32 * W, -0.03 * L]))
  .cut(2)
  // stepped base: centre notch between two feet
  .sketch(topPlane, (s) => s.rect(0.5 * W, 0.12 * L, [0, -L / 2 + 0.06 * L]))
  .cut(2.5);
