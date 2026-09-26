// task-12e audit probe: the negative-value fast path and the fast-path justification,
// run against the REAL modules. Node strips TypeScript types, so this imports the
// sources directly; nothing in the worktree is written. Output is captured to
// task-12e-audit-probe.log.
const ROOT = 'file:///D:/Documents/turing-complete/.worktrees/phase1/src/core/';

const signal = await import(`${ROOT}signal.ts`);
const wide = await import(`${ROOT}defs/wide.ts`);

console.log('=== Item 1: setPort(base, 32, -1) after the fix ===');
const table = signal.createSignalTable(1024);
const b32 = table.alloc(32);
try {
  table.setPort(b32, 32, -1);
  console.log('setPort(32, -1) ACCEPTED (bug still present)');
} catch (err) {
  console.log(`setPort(32, -1) threw: ${err.message}`);
}
console.log(`  getPort(32) afterwards = ${table.getPort(b32, 32)}  <- all zeros, -1 not staged`);

console.log('');
console.log('=== the arm is non-negative at every width >= 32 ===');
for (const width of [32, 33, 64]) {
  const base = table.alloc(width);
  const results = [];
  for (const v of [-1, -2147483648, 0, 0xffff_ffff, 2 ** 32]) {
    try {
      table.setPort(base, width, v);
      results.push(`${v} accepted`);
    } catch (err) {
      results.push(`${v} threw`);
    }
  }
  console.log(`width ${width}: ${results.join('; ')}`);
}

console.log('');
console.log('=== the justification for KEEPING the arm: the number writer carries 32 bits ===');
console.log(`(2**32 >>> 32) & 1 = ${((2 ** 32) >>> 32) & 1}  <- bit 32 of ANY number is 0`);
const bits33 = Array.from({ length: 33 }, (_, i) => ((2 ** 32) >>> i) & 1);
console.log(
  `setPort's number branch for a 33-bit port given 2**32 writes ` +
    `${bits33.reduce((a, b) => a + b, 0)} set bits -> would stage ` +
    `${bits33.reduce((a, b, i) => a + b * 2 ** i, 0)}, not ${2 ** 32}`,
);
console.log(
  'so without the arm, `v >= 0 && v < 2 ** 33` would ADMIT 2**32 and the writer would ' +
    'silently stage 0 instead of throwing.',
);

console.log('');
console.log('=== no regression at width 31 (the guard fixed in c830f50) ===');
const b31 = table.alloc(31);
for (const v of [0, 1, 2 ** 31 - 1, 2 ** 31, -1]) {
  try {
    table.setPort(b31, 31, v);
    console.log(`setPort(31, ${v}) accepted`);
  } catch (err) {
    console.log(`setPort(31, ${v}) threw: ${err.message}`);
  }
}

console.log('');
console.log('=== the maskOf claim in defs/wide.ts: maskOf(32) is what the guard admits ===');
const defs32 = wide.createWideDefs(32);
const div32 = defs32.find((d) => d.id === 'div32');
const out = [];
div32.evaluate([5, 0], out, undefined, { tick: 0 });
console.log(`div32(5, 0) number branch = ${out[0]} (maskOf(32) = ${2 ** 32 - 1})`);
const stage = signal.createSignalTable(1024);
const base32 = stage.alloc(32);
stage.setPort(base32, 32, out[0]);
console.log(`  staged at width 32 and read back = ${stage.getPort(base32, 32)}`);
console.log(`MAX_WIDE_WIDTH = ${wide.MAX_WIDE_WIDTH}; clampWidth(1e9) = ${wide.clampWidth(1e9)}`);
