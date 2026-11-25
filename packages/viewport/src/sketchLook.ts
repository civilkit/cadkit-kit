/** How the sketch editor draws its lines. Pure constants, so a test can pin them. */
export const SOLID_COLOUR = 0x0b74dc, SOLID_PX = 2.2;
/** Construction lines: a teal of their own, dashed, as heavy as the solid lines. A deep teal on a light background, a bright one on a dark one (a first,
 *  lighter 1.6 px teal read as faint: pixel (57,179,191) on (226,232,239)). */
export const CONSTRUCTION_PX = 2.2;
export const CONSTRUCTION_LIGHT = 0x087f8c, CONSTRUCTION_DARK = 0x3cc8d6;
export const constructionColour = (dark: boolean): number => (dark ? CONSTRUCTION_DARK : CONSTRUCTION_LIGHT);
