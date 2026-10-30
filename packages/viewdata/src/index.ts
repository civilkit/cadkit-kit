// @kit/viewdata: the stored view of a part (what the viewer shows before the kernel has rebuilt it): how it is built from a kernel
// reply, keyed, encoded and checked. Shared by the app and the agent tools.
export * from './viewCache';
export * from './build';
export * from './surfaces';
export * from './errorSummary';
export * from './diagnosticsText';
export * from './taperLimit';
export { diagStrings } from './strings';
