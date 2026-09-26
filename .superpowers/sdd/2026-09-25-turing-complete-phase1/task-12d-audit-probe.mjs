// task-12d audit probe: the `1 << width` family, run against the REAL modules.
// Node 24 strips TypeScript types, so this imports the sources directly; nothing
// in the worktree is written. Output is captured to task-12d-audit-probe.log.
const ROOT = 'file:///D:/Documents/turing-complete/.worktrees/phase1/src/core/';

const fields = await import(`${ROOT}fields.ts`);
const signal = await import(`${ROOT}signal.ts`);

console.log('=== fields.ts:16,29 -- `width >= 32 ? 0xffff_ffff : (1 << width) - 1` ===');
for (const width of [30, 31, 32]) {
  const mask = width >= 32 ? 0xffff_ffff : (1 << width) - 1;
  console.log(
    `width ${width}: mask literal = ${mask}  (as int32 ${mask | 0}, unsigned ${mask >>> 0})`,
  );
  const all = 2 ** width - 1;
  let extracted;
  try {
    extracted = fields.extractField(all, 0, width);
  } catch (err) {
    extracted = `threw RangeError: ${err.message}`;
  }
  console.log(`  extractField(2**${width}-1, 0, ${width}) = ${extracted}`);
  for (const field of [0, 1, 2 ** (width - 1), all]) {
    let inserted;
    try {
      inserted = fields.insertField(0, 0, width, field);
    } catch (err) {
      inserted = `threw RangeError: ${err.message}`;
    }
    console.log(`  insertField(0, 0, ${width}, ${field}) = ${inserted}`);
  }
}

console.log('');
console.log('=== signal.ts -- the number writer carries 32 bits (`(v >>> i) & 1`) ===');
console.log(`(2**32 >>> 32) & 1 = ${((2 ** 32) >>> 32) & 1}  <- bit 32 of ANY number is 0`);
// The writer's number branch, quoted from setPort, for a value only the guard can
// keep out: `setPort(base, 33, 2 ** 32)` would write all-zero bits.
const bits33 = Array.from({ length: 33 }, (_, i) => ((2 ** 32) >>> i) & 1);
console.log(
  `setPort(base, 33, 2**32) number branch writes ${bits33.reduce((a, b) => a + b, 0)} set bits`,
);
console.log(`  so it would stage ${bits33.reduce((a, b, i) => a + b * 2 ** i, 0)}, not ${2 ** 32}`);

console.log('');
console.log('=== signal.ts:20 (the fix) and the `width >= 32` arm, through the table ===');
const table = signal.createSignalTable(512);
const b31 = table.alloc(31);
table.setPort(b31, 31, 2 ** 31 - 1);
console.log(`setPort(31, 2**31 - 1) accepted; getPort = ${table.getPort(b31, 31)}`);
try {
  table.setPort(b31, 31, 2 ** 31);
  console.log('setPort(31, 2**31) ACCEPTED (bug)');
} catch (err) {
  console.log(`setPort(31, 2**31) threw: ${err.message}`);
}

const b32 = table.alloc(32);
table.setPort(b32, 32, -1);
console.log(
  `setPort(32, -1) accepted today (the arm omits the sign check); getPort = ${table.getPort(b32, 32)}`,
);
for (const width of [32, 33, 64]) {
  const base = table.alloc(width);
  const results = [];
  for (const v of [0xffff_ffff, 2 ** 32]) {
    try {
      table.setPort(base, width, v);
      results.push(`${v} accepted`);
    } catch (err) {
      results.push(`${v} threw (${err.message})`);
    }
  }
  console.log(`width ${width}: ${results.join('; ')}`);
}
