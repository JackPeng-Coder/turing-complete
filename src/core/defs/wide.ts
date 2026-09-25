import type { ComponentCategory, ComponentDef, PinDef } from '../registry';
import type { PortValue } from '../signal';

/**
 * The wide (8-bit) family: bitwise, arithmetic, shift, compare and the two bit
 * packers. Every def here is pure combinational -- no state, no clock edge --
 * and every one of them is a *generator* result, so phase 5 can register the
 * same operators at 16/32/64 bits without a second copy of the semantics.
 *
 * Three rules this module establishes, because nothing in the project had a
 * width other than 1 before it:
 *
 *  * **Ids and pin names are the contract.** `and8.a`, `add8.cout`,
 *    `splitter.b0` and the rest are addressed verbatim by the chapter-2 level
 *    data, so they are written out literally in `createWideDefs` rather than
 *    derived from a clever naming scheme.
 *  * **Values are unsigned patterns, never negative numbers.** An 8-bit port
 *    carries 0..255; two's complement exists only *inside* `less_s` and `ashr8`,
 *    which convert to a signed value to read the sign and then return an
 *    unsigned pattern again. `assertWidth` accepts nothing else on the way in.
 *  * **Edge behaviour is decided, not accidental** -- see each operator.
 *
 * PARAMETERS (`splitter` / `maker`). The brief requires their pin COUNT to be
 * configurable, and the only per-instance knob is `params.width`. That knob
 * cannot do this job: the kernel resolves a pin's width as
 * `inst.params.width ?? pin.width` for EVERY pin of the instance (`net.ts`,
 * `effectiveWidth`), so `params.width = 4` on a splitter would not give it four
 * outputs -- it would give all eight of them four bits each, which is a
 * different and wrong component. The pin count is therefore a parameter of the
 * DEF, not of the instance: `createWideDefs(width)` builds a splitter with
 * exactly `width` one-bit outputs and a maker with exactly `width` one-bit
 * inputs, and this phase registers the default 8. A level that needs four bits
 * uses `b0..b3` of the registered splitter and leaves the rest unwired (an
 * unwired pin reads 0). Per-instance counts would need a def-level hook in
 * `net.ts`, which this task does not own.
 *
 * COST. `cost` is what the gate metric counts and what `delayOf` charges per
 * node, so it is 1 for every operator, 0 for the constant source (like
 * `const_on`) and 0 for the two packers (they are wires, like `level_output`).
 * A larger, NAND-equivalent cost belongs to the phase that implements
 * `expand()`; charging it now would give a wide part a multi-unit delay and
 * break the rule that every component contributes exactly one unit of delay.
 */

/** The width every wide def is registered at in this phase (spec §3.3). */
export const DEFAULT_WIDE_WIDTH = 8;

/**
 * Hard ceiling on a generated width.
 *
 * `PortValue` is a `number` up to 32 bits and a `Uint8Array` above that, and
 * every operator below carries its result in a `number`. 32 is therefore where
 * this phase stops: a request above it is clamped rather than allowed to build
 * pins whose values this module cannot legally produce.
 */
export const MAX_WIDE_WIDTH = 32;

/**
 * Clamps a requested width into `[1, MAX_WIDE_WIDTH]`, defaulting to 8.
 *
 * `undefined` (no width asked for) and `NaN` (a poisoned computation, where
 * `Math.trunc` would yield `NaN` and every pin width with it) fall back to the
 * default. Everything else is truncated toward zero and clamped, so an absurd
 * request is bounded before it can reach the signal table: `clampWidth(1e9)` is
 * 32, not a pin list that asks `alloc` for gigabytes.
 */
export function clampWidth(width: number | undefined): number {
  if (width === undefined || Number.isNaN(width)) return DEFAULT_WIDE_WIDTH;
  return Math.min(MAX_WIDE_WIDTH, Math.max(1, Math.trunc(width)));
}

/** Low-`w`-bit mask. `1 << 32` is `1` in JS, so 32 is handled separately. */
function maskOf(w: number): number {
  return w >= 32 ? 0xffff_ffff : (1 << w) - 1;
}

/**
 * Truncates `value` to `w` bits and returns a NON-NEGATIVE number.
 *
 * `& mask` alone is not enough once bit 31 is set: the bitwise operators convert
 * through `int32`, so `0xffff_ffff & 0xffff_ffff` is `-1`. A negative number
 * would then fail `assertWidth` on its way into a port, which is exactly the
 * "negative reading" the brief forbids -- so every result passes through here.
 */
function u(value: number, w: number): number {
  return (value & maskOf(w)) >>> 0;
}

/**
 * Reads a port value as an unsigned `w`-bit integer.
 *
 * Both carriers are accepted because both occur: `signal.ts` hands a def a
 * `number` for a pin up to 8 bits wide and a little-endian `Uint8Array` above
 * that, and the same `evaluate` runs at either width. A missing input reads 0,
 * matching the kernel's own "a bit with no driver reads 0".
 *
 * Exported because reading a wide pin is every later def's problem too
 * (`reg8`, `mux8`, `counter8`, `delay8`), and a second copy of this
 * number/bytes split is a second place for it to go wrong.
 */
export function toUint(v: PortValue | undefined, w: number): number {
  if (v === undefined) return 0;
  if (typeof v === 'number') return u(v, w);
  // Four bytes is all a `number` carries exactly; wider pins are phase 5's.
  let out = 0;
  for (let i = Math.min(v.length, 4) - 1; i >= 0; i -= 1) out = out * 256 + (v[i] ?? 0);
  return u(out, w);
}

/** A single-bit port, read as 0 or 1. */
function bit(v: PortValue | undefined): number {
  return toUint(v, 1);
}

/**
 * Two's-complement value of an unsigned `w`-bit pattern.
 *
 * Used only to read a sign -- for the comparison in `less_s` and the sign bit in
 * `ashr8`. The result never leaves this module: both operators return an
 * unsigned pattern.
 */
function toSigned(v: number, w: number): number {
  const x = u(v, w);
  return x >= 2 ** (w - 1) ? x - 2 ** w : x;
}

// ---------------------------------------------------------------------------
// Operators. Each is the single definition of its semantics; the defs below are
// thin wrappers that read pins, call one of these and write pins.
// ---------------------------------------------------------------------------

/**
 * Add with carry in. `out` is the low `w` bits, `cout` is bit `w` -- the carry
 * out of the top bit, which makes `add8` chainable into a 16-bit adder later.
 *
 * `out` and `cout` are computed from the same integer sum, so the two pins can
 * never disagree about whether the addition overflowed.
 */
function addOp(a: number, b: number, cin: number, w: number): { out: number; cout: number } {
  const sum = u(a, w) + u(b, w) + (cin & 1);
  // `Math.floor(sum / 2 ** w)`, not `sum >> w`: `>>` takes its shift count
  // modulo 32, so at w = 32 it would report bit 0 of the sum as the carry.
  return { out: u(sum, w), cout: Math.floor(sum / 2 ** w) & 1 };
}

/** Two's complement negation. `neg(0)` is 0, and `neg(0x80)` is `0x80`. */
function negOp(a: number, w: number): number {
  // `2 ** w - a` masked is `(2 ** w - a) mod 2 ** w`, so no negative
  // intermediate exists at any point -- not even for `neg(0)`.
  return u(2 ** w - u(a, w), w);
}

function lessSignedOp(a: number, b: number, w: number): number {
  return toSigned(a, w) < toSigned(b, w) ? 1 : 0;
}

function lessUnsignedOp(a: number, b: number, w: number): number {
  return u(a, w) < u(b, w) ? 1 : 0;
}

function equalOp(a: number, b: number, w: number): number {
  return u(a, w) === u(b, w) ? 1 : 0;
}

/** Logical left shift. Decided: an amount of `w` or more gives 0. */
function shiftLeftOp(a: number, amount: number, w: number): number {
  const s = u(amount, w);
  if (s >= w) return 0;
  return u(u(a, w) << s, w);
}

/** Logical right shift: zeros shift in from the top. Amount >= `w` gives 0. */
function shiftRightOp(a: number, amount: number, w: number): number {
  const s = u(amount, w);
  if (s >= w) return 0;
  return u(u(a, w) >>> s, w);
}

/**
 * Arithmetic right shift: the sign bit replicates, so a negative pattern stays
 * negative. An amount of `w` or more fills with the sign bit (`0xff` for a
 * negative byte) rather than giving 0 -- that is what makes `ashr8` the signed
 * counterpart of `shift_r8` instead of a duplicate of it.
 */
function shiftRightArithmeticOp(a: number, amount: number, w: number): number {
  const s = u(amount, w);
  const signed = toSigned(a, w);
  if (s >= w) return signed < 0 ? maskOf(w) : 0;
  return u(signed >> s, w);
}

/** Rotate left. Decided: an amount >= `w` behaves as `amount % w`. */
function rotateLeftOp(a: number, amount: number, w: number): number {
  const v = u(a, w);
  const s = u(amount, w) % w;
  if (s === 0) return v;
  return u((v << s) | (v >>> (w - s)), w);
}

/** Rotate right. Decided: an amount >= `w` behaves as `amount % w`. */
function rotateRightOp(a: number, amount: number, w: number): number {
  const v = u(a, w);
  const s = u(amount, w) % w;
  if (s === 0) return v;
  return u((v >>> s) | (v << (w - s)), w);
}

/**
 * Multiply, keeping only the low `w` bits -- `mul8(16, 16)` is 0, exactly as an
 * 8-bit multiplier's `out` pin would be. The high half is discarded, not
 * reported: `mul8` has no high output pin.
 */
function multiplyOp(a: number, b: number, w: number): number {
  const x = u(a, w);
  const y = u(b, w);
  // Split `x` in half so no intermediate exceeds 2 ** 53. `x * y` alone would
  // for w = 32, and a double that has lost its low bits would silently corrupt
  // the very bits this operator keeps. Reducing the high half modulo 2 ** w
  // first is safe: the dropped part is a multiple of 2 ** w.
  const half = Math.ceil(w / 2);
  const base = 2 ** half;
  const lo = x % base;
  const hi = (x - lo) / base;
  return u(((hi * y) % 2 ** w) * base + lo * y, w);
}

/**
 * Integer division, truncated toward zero (the operands are unsigned, so this is
 * also floor).
 *
 * DECIDED, not undefined: division by zero returns all ones -- `0xff` at width
 * 8. Every numerator gets the same answer, so a level can rely on it, and a
 * divider built from this can never produce a value the port cannot carry.
 */
function divideOp(a: number, b: number, w: number): number {
  const divisor = u(b, w);
  if (divisor === 0) return maskOf(w);
  return Math.floor(u(a, w) / divisor);
}

/** `b0..b{w-1}`, least significant bit first: the splitter's transfer function. */
function splitOp(value: number, w: number): number[] {
  const v = u(value, w);
  return Array.from({ length: w }, (_, b) => (v >>> b) & 1);
}

/** The inverse of `splitOp`: `makeOp(splitOp(x, w), w) === x`. */
function makeOp(bits: readonly number[], w: number): number {
  let out = 0;
  for (let b = 0; b < w; b += 1) out += bit(bits[b]) << b;
  return u(out, w);
}

// ---------------------------------------------------------------------------
// Def builders
// ---------------------------------------------------------------------------

const combinational = (
  id: string,
  name: { zh: string; en: string },
  category: ComponentCategory,
  inputs: readonly PinDef[],
  outputs: readonly PinDef[],
  cost: number,
  evaluate: (inputs: readonly PortValue[], outputs: PortValue[]) => void,
): ComponentDef => ({
  id,
  name,
  category,
  inputs,
  outputs,
  cost,
  sequential: false,
  stateBytes: 0,
  evaluate,
});

const wideOut = (w: number): PinDef[] => [{ id: 'out', width: w }];
const bitOut = (): PinDef[] => [{ id: 'out', width: 1 }];

/** One gate per bit; `fn` receives values already masked to `w` bits. */
function bitwise2(
  id: string,
  name: { zh: string; en: string },
  w: number,
  fn: (a: number, b: number) => number,
): ComponentDef {
  return combinational(
    id,
    name,
    'wide',
    [
      { id: 'a', width: w },
      { id: 'b', width: w },
    ],
    wideOut(w),
    1,
    (i, o) => {
      o[0] = u(fn(toUint(i[0], w), toUint(i[1], w)), w);
    },
  );
}

function bitwise1(
  id: string,
  name: { zh: string; en: string },
  w: number,
  fn: (a: number) => number,
): ComponentDef {
  return combinational(id, name, 'wide', [{ id: 'a', width: w }], wideOut(w), 1, (i, o) => {
    o[0] = u(fn(toUint(i[0], w)), w);
  });
}

function addDef(w: number): ComponentDef {
  return combinational(
    `add${w}`,
    { zh: `${w} 位加法器`, en: `${w}-Bit Adder` },
    'wide',
    [
      { id: 'a', width: w },
      { id: 'b', width: w },
      { id: 'cin', width: 1 },
    ],
    [{ id: 'out', width: w }, { id: 'cout', width: 1 }],
    1,
    (i, o) => {
      const sum = addOp(toUint(i[0], w), toUint(i[1], w), bit(i[2]), w);
      o[0] = sum.out;
      o[1] = sum.cout;
    },
  );
}

function negDef(w: number): ComponentDef {
  return bitwise1(`neg${w}`, { zh: `${w} 位取负`, en: `${w}-Bit Negate` }, w, (a) =>
    negOp(a, w),
  );
}

function compareDef(
  id: string,
  name: { zh: string; en: string },
  w: number,
  fn: (a: number, b: number, w: number) => number,
): ComponentDef {
  return combinational(
    id,
    name,
    'wide',
    [
      { id: 'a', width: w },
      { id: 'b', width: w },
    ],
    bitOut(),
    1,
    (i, o) => {
      o[0] = fn(toUint(i[0], w), toUint(i[1], w), w);
    },
  );
}

function shiftDef(
  id: string,
  name: { zh: string; en: string },
  w: number,
  fn: (a: number, amount: number, w: number) => number,
): ComponentDef {
  return combinational(
    id,
    name,
    'wide',
    [
      { id: 'a', width: w },
      { id: 'amount', width: w },
    ],
    wideOut(w),
    1,
    (i, o) => {
      o[0] = fn(toUint(i[0], w), toUint(i[1], w), w);
    },
  );
}

function binaryDef(
  id: string,
  name: { zh: string; en: string },
  w: number,
  fn: (a: number, b: number, w: number) => number,
): ComponentDef {
  return combinational(
    id,
    name,
    'wide',
    [
      { id: 'a', width: w },
      { id: 'b', width: w },
    ],
    wideOut(w),
    1,
    (i, o) => {
      o[0] = fn(toUint(i[0], w), toUint(i[1], w), w);
    },
  );
}

/**
 * The conditional pass (`switch` / `switch{w}`): `on = 1` passes `a` through,
 * `on = 0` forces the output to zero. Decided form -- forcing zero rather than
 * free-running is what makes these safe to cascade.
 */
function switchDef(id: string, name: { zh: string; en: string }, w: number): ComponentDef {
  return combinational(
    id,
    name,
    'wide',
    [
      { id: 'a', width: w },
      { id: 'on', width: 1 },
    ],
    wideOut(w),
    1,
    (i, o) => {
      o[0] = bit(i[1]) === 1 ? toUint(i[0], w) : 0;
    },
  );
}

/**
 * The 8-bit constant source.
 *
 * It has no value parameter -- `params` carries numbers, and the kernel reads
 * only `params.width` -- so its value is a module constant: all ones. All zeros
 * needs no component at all (an unwired input already reads 0, and the kernel
 * says so with a `dangling-input` warning), so the useful constant to spend a
 * palette slot on is the one a circuit cannot synthesise for free.
 */
const CONST_VALUE = 0xff;

function constDef(w: number): ComponentDef {
  return combinational(
    `const${w}`,
    { zh: `${w} 位常量`, en: `${w}-Bit Constant` },
    // A source, not a gate: `const_on` / `const_off` are `io` for the same
    // reason, and nothing groups the palette by category.
    'io',
    [],
    wideOut(w),
    0,
    (_i, o) => {
      o[0] = u(CONST_VALUE, w);
    },
  );
}

/**
 * `splitter`: one `w`-bit input, `w` one-bit outputs `b0..b{w-1}`, least
 * significant bit first. Pure wiring, so it costs no gate.
 */
function splitterDef(w: number): ComponentDef {
  return combinational(
    'splitter',
    { zh: '位拆分器', en: 'Splitter' },
    'wide',
    [{ id: 'in', width: w }],
    Array.from({ length: w }, (_, b) => ({ id: `b${b}`, width: 1 })),
    0,
    (i, o) => {
      const bits = splitOp(toUint(i[0], w), w);
      for (let b = 0; b < w; b += 1) o[b] = bits[b]!;
    },
  );
}

/** `maker`: `w` one-bit inputs `b0..b{w-1}` in, one `w`-bit value out. */
function makerDef(w: number): ComponentDef {
  return combinational(
    'maker',
    { zh: '位合并器', en: 'Maker' },
    'wide',
    Array.from({ length: w }, (_, b) => ({ id: `b${b}`, width: 1 })),
    wideOut(w),
    0,
    (i, o) => {
      o[0] = makeOp(
        Array.from({ length: w }, (_, b) => bit(i[b])),
        w,
      );
    },
  );
}

/**
 * Ids `createWideDefs(8)` produces, in order, as a literal tuple so `DEF_IDS`
 * can spread it and `DefId` still narrows to the individual strings.
 *
 * The width-suffixed operators are named `stem + width`; `less_s`, `less_u`,
 * `splitter`, `maker` and the one-bit `switch` carry no suffix in the contract,
 * so they keep their names at every width this phase can generate. Renaming
 * them for 16/32/64 is phase 5's call, and `test/core/defs-wide.test.ts` pins
 * that this list and the generated defs agree at the registered width.
 */
export const WIDE_DEF_IDS = [
  'and8',
  'or8',
  'nand8',
  'nor8',
  'xor8',
  'xnor8',
  'not8',
  'add8',
  'neg8',
  'less_s',
  'less_u',
  'equal8',
  'shift_l8',
  'shift_r8',
  'ashr8',
  'rot_l8',
  'rot_r8',
  'mul8',
  'div8',
  'const8',
  'splitter',
  'maker',
  'switch',
  'switch8',
] as const;

/**
 * The whole family at `width` bits, in `WIDE_DEF_IDS` order.
 *
 * `width` defaults to 8, which is the only width this phase registers; the
 * parameter exists so phase 5 can call this with 16, 32 or 64 instead of
 * growing a second family of defs next to this one. It is clamped (see
 * `clampWidth`), never trusted: a width of `1e9` would otherwise build a
 * splitter with a billion one-bit output pins.
 */
export function createWideDefs(width: number = DEFAULT_WIDE_WIDTH): readonly ComponentDef[] {
  const w = clampWidth(width);
  return [
    bitwise2(`and${w}`, { zh: `${w} 位与门`, en: `${w}-Bit AND` }, w, (a, b) => a & b),
    bitwise2(`or${w}`, { zh: `${w} 位或门`, en: `${w}-Bit OR` }, w, (a, b) => a | b),
    bitwise2(`nand${w}`, { zh: `${w} 位与非门`, en: `${w}-Bit NAND` }, w, (a, b) => ~(a & b)),
    bitwise2(`nor${w}`, { zh: `${w} 位或非门`, en: `${w}-Bit NOR` }, w, (a, b) => ~(a | b)),
    bitwise2(`xor${w}`, { zh: `${w} 位异或门`, en: `${w}-Bit XOR` }, w, (a, b) => a ^ b),
    bitwise2(`xnor${w}`, { zh: `${w} 位同或门`, en: `${w}-Bit XNOR` }, w, (a, b) => ~(a ^ b)),
    bitwise1(`not${w}`, { zh: `${w} 位非门`, en: `${w}-Bit NOT` }, w, (a) => ~a),
    addDef(w),
    negDef(w),
    // `less_s` is the only operator that reads its operands as two's
    // complement, and the reading stops at the return value: the output pin is a
    // single bit, so no signed number ever reaches a port.
    compareDef('less_s', { zh: '有符号小于', en: 'Signed Less Than' }, w, lessSignedOp),
    compareDef('less_u', { zh: '无符号小于', en: 'Unsigned Less Than' }, w, lessUnsignedOp),
    compareDef(`equal${w}`, { zh: `${w} 位相等`, en: `${w}-Bit Equal` }, w, equalOp),
    shiftDef(`shift_l${w}`, { zh: `${w} 位左移`, en: `${w}-Bit Shift Left` }, w, shiftLeftOp),
    shiftDef(`shift_r${w}`, { zh: `${w} 位右移`, en: `${w}-Bit Shift Right` }, w, shiftRightOp),
    shiftDef(`ashr${w}`, { zh: `${w} 位算术右移`, en: `${w}-Bit Arithmetic Shift Right` }, w, shiftRightArithmeticOp),
    shiftDef(`rot_l${w}`, { zh: `${w} 位循环左移`, en: `${w}-Bit Rotate Left` }, w, rotateLeftOp),
    shiftDef(`rot_r${w}`, { zh: `${w} 位循环右移`, en: `${w}-Bit Rotate Right` }, w, rotateRightOp),
    binaryDef(`mul${w}`, { zh: `${w} 位乘法器`, en: `${w}-Bit Multiplier` }, w, multiplyOp),
    binaryDef(`div${w}`, { zh: `${w} 位除法器`, en: `${w}-Bit Divider` }, w, divideOp),
    constDef(w),
    splitterDef(w),
    makerDef(w),
    // The one-bit conditional pass is width-independent and keeps its bare id,
    // so `createWideDefs(8)` yields the pair `switch` / `switch8` the contract
    // asks for.
    switchDef('switch', { zh: '开关', en: 'Switch' }, 1),
    switchDef(`switch${w}`, { zh: `${w} 位开关`, en: `${w}-Bit Switch` }, w),
  ];
}
