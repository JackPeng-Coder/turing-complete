import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

// The `pnpm` shim on this host's PATH is a broken PowerShell wrapper, so the
// preview server is started through the bundled Node binary instead.
//
// Both halves are resolved here rather than read out of the environment,
// because an unset variable used to produce `"node" "pnpm" build`: node trying
// to load a module named `pnpm`, which exits 1 before a single test runs.
//
//   * NODE defaults to `process.execPath` -- the node running Playwright. It is
//     always correct and needs no environment variable. (Note this is not
//     necessarily the bundled node: pnpm starts `playwright test` through
//     `node_modules/.bin/playwright`, which picks up whatever `node` is on
//     PATH. Any real node can run the `pnpm.mjs` script below.)
//   * PNPM defaults to the bundled `pnpm.mjs` when that file exists, and to a
//     real `pnpm` executable otherwise -- which is what a normal host has.
//     The first candidate is this host's runtime; the second is the sibling
//     layout of a bundled runtime (`<deps>/node/bin/node.exe` next to
//     `<deps>/pnpm/bin/pnpm.mjs`) for when the bundled node is the one running.
//
// `NODE_BIN` / `PNPM_BIN` still override both. A value that looks like a path
// is a script and is handed to node; a bare `pnpm` is a real executable and is
// spawned directly, so it must not be quoted into a module specifier.
//
// This file is deliberately outside `tsconfig.include`: it reads `process.env`
// and the project has no `@types/node` (nothing may be added to package.json).
// Playwright transpiles its own config, so it is loaded without `tsc`.
const NODE = process.env.NODE_BIN ?? process.execPath;
const PNPM_CANDIDATES = [
  'C:\\Users\\ME\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\pnpm\\bin\\pnpm.mjs',
  resolve(dirname(process.execPath), '..', '..', 'pnpm', 'bin', 'pnpm.mjs'),
];
const BUNDLED_PNPM = PNPM_CANDIDATES.find((candidate) => existsSync(candidate));
const PNPM = process.env.PNPM_BIN ?? BUNDLED_PNPM ?? 'pnpm';

/** `pnpm.mjs` is a script for node to run; a bare `pnpm` is a command to spawn. */
const PNPM_COMMAND = /[/\\]/.test(PNPM) ? `"${NODE}" "${PNPM}"` : PNPM;

export default defineConfig({
  testDir: './test/smoke',
  testMatch: /.*\.spec\.ts/,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    // `--host 127.0.0.1` is not decoration: Vite 8 binds `preview` to whatever
    // `localhost` resolves to first, and on a host whose resolver prefers IPv6
    // that is `::1` alone. The probe below is an IPv4 literal, so without this
    // the server came up, the URL was refused, and the gate sat here until the
    // 180-second timeout expired with the suite never starting.
    command: `${PNPM_COMMAND} build && ${PNPM_COMMAND} preview --host 127.0.0.1 --port 4173 --strictPort`,
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
