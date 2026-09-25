/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { target: 'es2022', outDir: 'dist' },
  test: {
    globals: true,
    // node is the default: the engine and level tests must not need a DOM.
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // The board-view tests build DOM-free geometry, but anything that touches
    // `document` (palette, shell, truth table) needs a DOM. Opt those in
    // per file rather than making every test pay for jsdom, by putting
    // `// @vitest-environment jsdom` on the first line of the test file
    // (see `test/ui/panels.test.ts`, phase-0 plan Task 11).
    //
    // Vitest 5 removed the `environmentMatchGlobs` directory mapping this task
    // originally specified: it is silently ignored at runtime and rejected by
    // `tsc`, so keeping it would break `pnpm build`.
  },
});
