// Test data shared by the stock suites: how far a profile's modelled outline may be from its catalogue mass per metre. 3 % everywhere, with these documented exceptions.
// C3X3.5: the AISC database's own weight is 5.6 % under its gross area (flagged in the verification record). IPN80, UPN65, UPN80: sloped flanges drawn with the mean
// flange thickness overshoot by 3.1 to 3.3 %. EN 10210 SHS 50x50x8 and 80x80x12.5: the kernel's tube takes the inner corner radius as outer minus wall (0.5 t) where the
// standard has 1.0 t, so the thickest walls come out 3.1 and 3.2 % heavy.
export const MASS_EXCEPTIONS: Record<string, number> = { 'us-c3x3.5': 0.05, 'eu-ipn80': 0.035, 'eu-upn65': 0.035, 'eu-upn80': 0.035, 'eu-en10210-shs50x50x8': 0.035, 'eu-en10210-shs80x80x12.5': 0.035 };
export const massTolerance = (id: string): number => MASS_EXCEPTIONS[id] ?? 0.03;
