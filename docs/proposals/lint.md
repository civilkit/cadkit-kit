# Proposal: a minimal linter (three rules)

Status: proposal, not installed. It adds dev dependencies and changes `package-lock.json`, so it needs the owner's approval. Nothing was installed.

Neither the app repo nor the kernel repo has ESLint. The aim is the smallest setup that stops three kinds of regression, not a style policy.

## Rules

1. **No explicit `any`**: `@typescript-eslint/no-explicit-any`, severity error. `unknown` plus a narrowing is the replacement.
2. **Restricted type assertions**: stop new `as never` (119 in `apps/cad/src/main.tsx` at the time of the review) and `as any`.
   Use core `no-restricted-syntax` with a selector, so no extra plugin is needed:
   `TSAsExpression[typeAnnotation.type="TSNeverKeyword"]`, message "as never hides a type mismatch: fix the type, or add // TYPE: what differs".
   Existing sites are grandfathered with the baseline below.
3. **No imports from `apps/` inside `packages/`**: core `no-restricted-imports` with `patterns`
   (`**/apps/**` and `@app/*` if an alias is ever added), applied only to `packages/**` via an `overrides`/`files` block. Test files that
   load the app's controller (the `*.kernel.test.ts` files, which import `apps/cad/src/controller`) are listed in a second block that turns the rule off, so
   the rule stays strict for production code; `packages/mcp/bench` is excluded the same way.

## Config (flat config, `eslint.config.js`)

```js
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist*/', 'node_modules/', '**/*.d.ts', 'apps/cad/public/'] },
  ...tseslint.configs.base,                      // the parser only; no recommended rule set
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-syntax': ['error', {
        selector: 'TSAsExpression[typeAnnotation.type="TSNeverKeyword"]',
        message: 'as never hides a type mismatch: fix the type, or add // TYPE: what differs',
      }],
    },
  },
  {
    files: ['packages/**/*.{ts,tsx}'],
    ignores: ['packages/**/*.test.{ts,tsx}', 'packages/mcp/bench/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: [{ group: ['**/apps/**'], message: 'packages must not import from the app' }] }] },
  },
);
```

## Dependencies (dev only)

`eslint`, `typescript-eslint` (it brings `@typescript-eslint/parser` and the plugin). Two packages at the top level; no other plugin or preset.

## Adopting without a flood of errors

1. Run once, save the counts, and add an `--max-warnings`-style baseline: make the rules `warn` first and record the count in CI
   (`eslint . --format json | jq '[.[].messages[]] | length'`); CI fails only if the count goes up.
2. Fix by file (the G2 task already removes `as never` from `lastBody` sites), then flip each rule to `error` when its count is 0.
3. Add `npm run lint`, and run it in `tools/remote_vitest.sh`-style CI on the changed files only, so branches do not queue behind it.

## Known limits

- Rule 3 matches import paths, so `import '../../../apps/x'` and a bare `apps/...` are both caught only through the glob; a TS path alias to the app would
  need adding to the pattern.
- Type-aware rules (for example `no-unsafe-*`) are left out on purpose: they need the full program per file and are slow here.
