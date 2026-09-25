import { defineConfig } from '@playwright/test';

// The `pnpm` shim on this host's PATH is a broken PowerShell wrapper, so the
// preview server is started through the bundled Node binary instead. NODE and
// PNPM are supplied by the environment; on a normal Linux CI, set both to
// `pnpm` (or leave them unset and drop the quotes) and the command is the
// ordinary `pnpm build && pnpm preview`.
//
// This file is deliberately outside `tsconfig.include`: it reads `process.env`
// and the project has no `@types/node` (nothing may be added to package.json).
// Playwright transpiles its own config, so it is loaded without `tsc`.
const NODE = process.env.NODE_BIN ?? 'node';
const PNPM = process.env.PNPM_BIN ?? 'pnpm';

export default defineConfig({
  testDir: './test/smoke',
  testMatch: /.*\.spec\.ts/,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: `"${NODE}" "${PNPM}" build && "${NODE}" "${PNPM}" preview --port 4173 --strictPort`,
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
