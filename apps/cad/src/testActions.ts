import type { Actions } from './commands';

/** An Actions object whose every member (nested too) exists, so buildCommands emits every optional command. */
export const fullActions = (): Actions => {
  const deep = (): unknown => new Proxy(function () {}, { get: (_t, k) => (k === Symbol.toPrimitive ? () => 0 : deep()), apply: () => deep() });
  return deep() as Actions;
};

