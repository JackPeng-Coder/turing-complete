/**
 * The project's conventions, as assertions that can fail.
 *
 * This file is this project's substitute for a linter. AGENTS.md records why no
 * linter is pinned (a dependency policy of exact versions and zero runtime
 * packages, enforced by a host that rejects freshly published ones); the rules
 * that would otherwise live in prose live here instead, and they run under
 * `pnpm test` with everything else.
 *
 * It reads sources as text on purpose. A rule about *which layer may import
 * which* or *which CSS properties are allowed* is a rule about text, and the
 * only rules worth keeping are the ones that can fail. The trade-off is the one
 * a linter makes too: a rule written here has to be re-stated if the shape of
 * the code changes, so every assertion below names the decision it protects.
 */
import { describe, expect, it } from 'vitest';
import packageText from '../package.json?raw';
import { LEVELS, LEVEL_ORDER } from '../src/levels/index';

// ---------------------------------------------------------------------------
// Reading the repository
// ---------------------------------------------------------------------------

/**
 * A glob key as a repository-relative path.
 *
 * Vite hands back keys relative to *this* file, so a glob that reaches into the
 * directory this file lives in collapses to `./app/commands.test.ts` while one
 * that reaches a sibling directory stays `../docs/…`. Both forms mean the same
 * thing here, so every key is resolved against `test/` before use -- otherwise
 * the test suite's own directory silently vanishes from the picture.
 */
function repoPath(key: string): string {
  const stack = ['test']; // this file's directory, relative to the repository root
  for (const part of key.split('/')) {
    if (part === '.' || part === '') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}

/** Every file the project owns, as repository-relative paths. */
const TRACKED = Object.keys(
  import.meta.glob(['../src/**/*', '../test/**/*', '../tools/**/*', '../docs/**/*'], {
    query: '?raw',
  }),
).map(repoPath);

const SOURCES: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob('../src/**/*.ts', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>,
  ).map(([key, text]) => [repoPath(key), text]),
);

/** The single text a one-file glob matched; throws rather than returning undefined. */
function only(matched: Record<string, string>, what: string): string {
  const values = Object.values(matched);
  if (values.length !== 1) throw new Error(`expected exactly one ${what}, found ${values.length}`);
  return values[0]!;
}

const README = only(
  import.meta.glob('../README.md', { query: '?raw', import: 'default', eager: true }) as Record<
    string,
    string
  >,
  'README.md',
);

/** Every directory the tracked files imply, as `src/core/`-style paths. */
const DIRECTORIES = new Set<string>();
for (const key of TRACKED) {
  const parts = key.split('/');
  for (let depth = 1; depth < parts.length; depth += 1) {
    DIRECTORIES.add(`${parts.slice(0, depth).join('/')}/`);
  }
}

/** Block comments removed, so that prose about a rule is not read as the rule. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '');
}

// ---------------------------------------------------------------------------
// The layer rule
// ---------------------------------------------------------------------------

type Layer = 'core' | 'asm' | 'levels' | 'persist' | 'app' | 'ui';

const LAYERS: readonly string[] = ['core', 'asm', 'levels', 'persist', 'app', 'ui'];

function isLayer(name: string | undefined): name is Layer {
  return name !== undefined && LAYERS.includes(name);
}

/**
 * Which layers each layer may import, whether the import is a value or a type.
 *
 * This is the rule `docs/superpowers/plans/2026-09-25-turing-complete-phase0.md`
 * states as "four layers, one-way" -- restated to match the architecture the
 * code actually has, because that plan predates `asm/` and `persist/`, and
 * because `ui/` reads `core/` and `levels/` directly rather than going through
 * `app/`. What is enforced is the part that matters: nothing imports upwards.
 *
 * The order is `core <- asm <- levels <- app <- ui`, with `persist` beside
 * `app` (it reads `app/progress` to build an empty save).
 */
const MAY_IMPORT: Readonly<Record<Layer, readonly Layer[]>> = {
  core: ['core'],
  asm: ['core', 'asm'],
  levels: ['core', 'asm', 'levels'],
  persist: ['core', 'asm', 'levels', 'app', 'persist'],
  app: ['core', 'asm', 'levels', 'persist', 'app'],
  ui: ['core', 'asm', 'levels', 'persist', 'app', 'ui'],
};

/** `src/core/defs/wide.ts` -> `core`; `src/main.ts` -> null (the root composes). */
function layerOfFile(key: string): Layer | null {
  const head = key.split('/')[1];
  return isLayer(head) ? head : null;
}

/**
 * The layer a relative import lands in, or null when it lands outside `src/`
 * (a stylesheet, or a sibling at the root) -- those are not layer edges.
 */
function layerOfImport(fromKey: string, specifier: string): Layer | null {
  if (!specifier.startsWith('.')) return null; // a package, not a layer
  const stack = fromKey.split('/').slice(0, -1);
  for (const part of specifier.split('/')) {
    if (part === '.' || part === '') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  if (stack[0] !== 'src') return null;
  const head = stack[1];
  return isLayer(head) ? head : null;
}

const IMPORT_PATTERN = /(?:^|\n)[ \t]*(?:import|export)[^'"]*?\bfrom[ \t]+['"]([^'"]+)['"]/g;
const BARE_IMPORT_PATTERN = /(?:^|\n)[ \t]*import[ \t]+['"]([^'"]+)['"]/g;

function specifiersOf(source: string): string[] {
  const found = [...source.matchAll(IMPORT_PATTERN), ...source.matchAll(BARE_IMPORT_PATTERN)];
  return found.map((match) => match[1]!);
}

describe('the layer rule', () => {
  it('lets no module import upwards, runtime or type', () => {
    const violations: string[] = [];
    for (const [key, source] of Object.entries(SOURCES)) {
      const from = layerOfFile(key);
      const allowed = from === null ? null : MAY_IMPORT[from];
      if (from === null || allowed === null) continue; // src root and .d.ts files compose
      for (const specifier of specifiersOf(source)) {
        const to = layerOfImport(key, specifier);
        if (to === null || allowed.includes(to)) continue;
        violations.push(`${key} (${from}) imports '${specifier}' (${to})`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('reads every source file, so a silent miss cannot pass', () => {
    const layers = Object.keys(SOURCES).map(layerOfFile).filter((layer) => layer !== null);
    expect(new Set(layers)).toEqual(new Set(LAYERS));
    expect(Object.keys(SOURCES).length).toBeGreaterThan(50);
  });
});

// ---------------------------------------------------------------------------
// The README describes the repository that exists
// ---------------------------------------------------------------------------

/** The `src/`-prefixed directories the layout block claims, in claim order. */
function claimedDirectories(readme: string): string[] {
  const afterHeading = readme.split('## Project layout')[1];
  if (afterHeading === undefined) throw new Error('README has no "## Project layout" section');
  const block = afterHeading.split('```')[1];
  if (block === undefined) throw new Error('README has no fenced block under "## Project layout"');

  const claimed: string[] = [];
  let prefix = '';
  for (const line of block.split('\n')) {
    // A top-level entry starts at column 0 and may carry no annotation at all
    // (`src/` does not), so it is matched on its own rather than as a
    // name-plus-comment pair.
    const top = /^([\w][\w./-]*\/)/.exec(line);
    if (top !== null) {
      prefix = top[1]!;
      claimed.push(prefix);
      continue;
    }
    // A child is indented, and is followed by the aligned annotation column.
    const child = /^\s+([\w][\w./-]*\/)\s{2,}\S/.exec(line);
    if (child !== null) claimed.push(`${prefix}${child[1]!}`);
  }
  return claimed;
}

describe('the README layout', () => {
  it('names every top-level directory under src/', () => {
    const claimed = new Set(claimedDirectories(README));
    const undocumented = [...DIRECTORIES]
      .filter((dir) => /^src\/[\w-]+\/$/.test(dir) && !claimed.has(dir))
      .sort();
    expect(undocumented).toEqual([]);
  });

  it('claims no directory that does not exist', () => {
    const invented = claimedDirectories(README)
      .filter((dir) => !DIRECTORIES.has(dir))
      .sort();
    expect(invented).toEqual([]);
  });

  it('tells a reader where the record and the tooling live', () => {
    for (const path of ['tools/', 'docs/', '.superpowers/']) {
      expect(README.includes(path), `README never mentions ${path}`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// The dependency policy
// ---------------------------------------------------------------------------

describe('the dependency policy', () => {
  const pkg = JSON.parse(packageText) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  it('ships no runtime dependency at all', () => {
    expect(pkg.dependencies ?? {}).toEqual({});
  });

  it('pins every devDependency to an exact version', () => {
    const loose = Object.entries(pkg.devDependencies ?? {}).filter(
      ([, version]) => !/^\d+\.\d+\.\d+$/.test(version),
    );
    expect(loose).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The drawing rules
// ---------------------------------------------------------------------------

describe('the stylesheet', () => {
  const css = withoutComments(
    only(
      import.meta.glob('../src/ui/style.css', {
        query: '?raw',
        import: 'default',
        eager: true,
      }) as Record<string, string>,
      'stylesheet',
    ),
  );

  it('has no shadow anywhere, as README promises', () => {
    expect(css).not.toMatch(/(?:^|[{;\s])(?:box-shadow|text-shadow)\s*:/);
  });

  it('rounds nothing but the bit arrows and the result medal', () => {
    const offenders: string[] = [];
    for (const chunk of css.split('}')) {
      const [selector = '', body = ''] = chunk.split('{');
      if (!body.includes('border-radius')) continue;
      if (/\.bit\b|\.result-medal\b/.test(selector)) continue;
      offenders.push(selector.trim().replace(/\s+/g, ' '));
    }
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Level identity
// ---------------------------------------------------------------------------

describe('the level registry', () => {
  it('keys every level once, by a non-empty id', () => {
    expect(LEVEL_ORDER).toHaveLength(LEVELS.length);
    expect(LEVEL_ORDER.filter((id) => id.trim() === '')).toEqual([]);
    expect(new Set(LEVEL_ORDER).size).toBe(LEVEL_ORDER.length);
  });
});
