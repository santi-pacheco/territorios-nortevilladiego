/**
 * Types for `build-css.mjs` so `src/tokens.test.ts` can assert on the exact
 * CSS it generates (the module itself is plain ESM and loads `src/tokens.ts`
 * through Node's native type stripping).
 */
export function generateCss(): string;
export function writeCss(): string;
